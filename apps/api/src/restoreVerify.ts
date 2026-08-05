import { mkdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { Store } from "./store.js";
import { decryptText, sha256File } from "./crypto.js";
import { runCommand } from "./runner.js";
import { id, now } from "./ids.js";
import type { BackupArtifact, Destination, JobLogEntry, Source } from "./types.js";
import { downloadMicrosoftDrivePath } from "./microsoftGraph.js";
import { config } from "./config.js";

type Logger = (level: JobLogEntry["level"], message: string, data?: Record<string, unknown>) => Promise<void>;

export async function verifyRestoreForRun(store: Store, runId: string, stagingRoot: string) {
  const context = await loadContext(store, runId);
  const { run, policy, source, destination, artifact } = context;
  const log: Logger = async (level, message, data) => {
    await store.update((db) => {
      db.logs.push({ id: id("log"), runId, level, message, data, createdAt: now() });
    });
  };

  await log("info", "Restore verification started", { sourceType: source.type, artifact: artifact.path });
  const verifyDir = join(stagingRoot, "restore-checks", runId);
  await rm(verifyDir, { recursive: true, force: true });
  await mkdir(verifyDir, { recursive: true });

  try {
    const localArtifact = await downloadArtifact(destination, artifact, verifyDir, log, await getMicrosoftCredentials(store, String(destination.config.microsoftIntegrationId ?? "")));
    await verifyChecksum(localArtifact, artifact, log);
    const checkedArtifacts = source.type === "postgres"
      ? await verifyPostgresRestore(source, policy, runId, localArtifact, log)
      : await verifyMinioRestore(localArtifact, verifyDir, log);
    const verifiedAt = now();
    await store.update((db) => {
      const target = db.runs.find((item) => item.id === run.id);
      if (target) {
        target.status = "recoverable";
        target.verificationStatus = "restore_verified";
        target.verifiedAt = verifiedAt;
        target.errorCode = null;
        target.errorMessage = null;
      }
    });
    await log("info", "Restore verification passed", { checkedArtifacts });
    return { runId, status: "recoverable", verificationStatus: "restore_verified", checkedArtifacts, message: "Restore automatico validado" };
  } catch (error: any) {
    await store.update((db) => {
      const target = db.runs.find((item) => item.id === run.id);
      if (target) {
        target.status = "restore_failed";
        target.verificationStatus = "integrity_verified";
        target.errorCode = "RESTORE_VERIFICATION_FAILED";
        target.errorMessage = error.message;
      }
    });
    await log("error", "Restore verification failed", { error: error.message });
    return { runId, status: "restore_failed", verificationStatus: "integrity_verified", checkedArtifacts: 0, message: error.message };
  } finally {
    await rm(verifyDir, { recursive: true, force: true });
    await log("info", "Restore verification workspace cleaned");
  }
}

async function loadContext(store: Store, runId: string) {
  const db = await store.read();
  const run = db.runs.find((item) => item.id === runId);
  if (!run) throw new Error("Run not found");
  const source = db.sources.find((item) => item.id === run.sourceId);
  const policy = db.policies.find((item) => item.id === run.policyId);
  const destination = db.destinations.find((item) => item.id === run.destinationId);
  if (!source || !policy || !destination) throw new Error("Run policy, source or destination not found");
  const artifact = db.artifacts.find((item) => item.runId === run.id && item.kind !== "manifest");
  if (!artifact) throw new Error("No restore artifact found for run");
  return { run, policy, source, destination, artifact };
}

async function downloadArtifact(destination: Destination, artifact: BackupArtifact, verifyDir: string, log: Logger, microsoftCredentials?: any) {
  const localFile = join(verifyDir, basename(artifact.path));
  if ((destination.type === "onedrive" || destination.type === "sharepoint") && destination.config.mode === "graph") {
    const downloaded = await downloadMicrosoftDrivePath(destination.config as any, artifact.path, localFile, microsoftCredentials);
    await log("info", "Downloaded artifact from Microsoft Graph", { path: downloaded.path, sizeBytes: downloaded.sizeBytes });
    return localFile;
  }
  if (artifact.path.startsWith("/")) {
    await log("info", "Using local artifact for restore verification", { path: artifact.path });
    return artifact.path;
  }
  throw new Error("Restore verification requires Microsoft Graph or a local artifact path");
}

async function getMicrosoftCredentials(store: Store, integrationId?: string) {
  const db = await store.read();
  const saved = integrationId
    ? db.microsoftIntegrations?.find((item: any) => item.id === integrationId) ?? db.settings?.microsoft
    : db.settings?.microsoft ?? db.microsoftIntegrations?.[0];
  if (saved?.tenantId && saved?.clientId && saved?.encryptedClientSecret) {
    return { tenantId: saved.tenantId, clientId: saved.clientId, clientSecret: decryptText(saved.encryptedClientSecret, config.cookieSecret) };
  }
  if (config.microsoft.tenantId && config.microsoft.clientId && config.microsoft.clientSecret) return config.microsoft;
  return undefined;
}

async function verifyChecksum(localFile: string, artifact: BackupArtifact, log: Logger) {
  const info = await stat(localFile);
  if (info.size <= 0) throw new Error("Downloaded artifact is empty");
  const checksumSha256 = await sha256File(localFile);
  if (artifact.checksumSha256 && checksumSha256 !== artifact.checksumSha256) {
    throw new Error("Downloaded artifact checksum mismatch");
  }
  await log("info", "Downloaded artifact checksum verified", { checksumSha256, sizeBytes: info.size });
}

async function verifyPostgresRestore(source: Source, policy: any, runId: string, localFile: string, log: Logger) {
  const config = source.config as any;
  const scope = resolvePolicyScope(source, policy);
  if (scope.mode === "all") throw new Error("Automatic restore verification for PostgreSQL all-databases scope is not supported safely yet");
  const database = `snapvault_verify_${runId.replace(/[^a-zA-Z0-9_]/g, "_")}`.toLowerCase();
  const env = { PGPASSWORD: source.secrets.password ?? "" };
  await runCommand("dropdb", ["-h", String(config.host), "-p", String(config.port ?? 5432), "-U", String(config.username), "--if-exists", database], env);
  const created = await runCommand("createdb", ["-h", String(config.host), "-p", String(config.port ?? 5432), "-U", String(config.username), database], env);
  if (created.code !== 0) throw new Error(created.stderr || "temporary restore database creation failed");
  try {
    // Redireciona stdout do psql para /dev/null (pode ser grande em dumps verbosos).
    // stderr é capturado pelo runCommand para mensagens de erro.
    const restore = await runCommand("sh", ["-c", `gzip -cd "$1" | psql -h "$2" -p "$3" -U "$4" -d "$5" >/dev/null`, "sh", localFile, String(config.host), String(config.port ?? 5432), String(config.username), database], env);
    if (restore.code !== 0) throw new Error(restore.stderr || "postgres restore failed");
    const probe = await runCommand("psql", ["-h", String(config.host), "-p", String(config.port ?? 5432), "-U", String(config.username), "-d", database, "-tAc", "select count(*) from pg_class where relkind in ('r','v','m','S','f','p')"], env);
    if (probe.code !== 0) throw new Error(probe.stderr || "postgres restore validation failed");
    const objectCount = Number(probe.stdout.trim());
    if (!Number.isFinite(objectCount) || objectCount <= 0) throw new Error("postgres restore produced no database objects");
    await log("info", "PostgreSQL restore verified in temporary database", { database, objectCount });
    return objectCount;
  } finally {
    await runCommand("dropdb", ["-h", String(config.host), "-p", String(config.port ?? 5432), "-U", String(config.username), "--if-exists", database], env);
    await log("info", "PostgreSQL temporary restore database removed", { database });
  }
}

function resolvePolicyScope(source: Source, policy: any) {
  const scope = policy.sourceScope as any;
  if (scope?.mode) return scope;
  const config = source.config as any;
  if (source.type === "postgres") return { mode: config.scope === "all" ? "all" : "single", database: config.database };
  return { mode: config.scope === "all" ? "all" : "single", bucket: config.bucket, prefix: config.prefix ?? "" };
}

async function verifyMinioRestore(localFile: string, verifyDir: string, log: Logger) {
  const extractDir = join(verifyDir, "minio-extracted");
  await mkdir(extractDir, { recursive: true });
  const gzip = await runCommand("gzip", ["-t", localFile]);
  if (gzip.code !== 0) throw new Error(gzip.stderr || "minio snapshot gzip check failed");
  const tar = await runCommand("tar", ["-xzf", localFile, "-C", extractDir]);
  if (tar.code !== 0) throw new Error(tar.stderr || "minio snapshot extraction failed");
  // Conta arquivos sem acumular nomes em memória — find -printf "." imprime um ponto
  // por arquivo, o wc -c conta os bytes (= número de arquivos). Seguro para qualquer volume.
  const count = await runCommand("sh", ["-c", `find "$1" -type f -printf '.' | wc -c`, "sh", extractDir]);
  if (count.code !== 0) throw new Error(count.stderr || "minio snapshot file listing failed");
  const fileCount = Number(count.stdout.trim());
  if (!Number.isFinite(fileCount) || fileCount <= 0) throw new Error("minio snapshot contains no files");
  await log("info", "MinIO snapshot restore verified in temporary workspace", { files: fileCount });
  return fileCount;
}
