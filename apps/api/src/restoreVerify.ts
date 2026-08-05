import { mkdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AppDb } from "./db.js";
import { decryptText, sha256File } from "./crypto.js";
import { runCommand } from "./runner.js";
import { id, now } from "./ids.js";
import type { BackupArtifact, Destination, JobLogEntry, Source } from "./types.js";
import { downloadMicrosoftDrivePath } from "./microsoftGraph.js";
import { config } from "./config.js";

type Logger = (level: JobLogEntry["level"], message: string, data?: Record<string, unknown>) => Promise<void>;

export async function verifyRestoreForRun(db: AppDb, runId: string, stagingRoot: string) {
  const context = await loadContext(db, runId);
  const { run, policy, source, destination, artifact } = context;
  const log: Logger = async (level, message, data) => {
    await db.addLog({ id: id("log"), runId, level, message, data, createdAt: now() });
  };

  await log("info", "Restore verification started", { sourceType: source.type, artifact: artifact.path });
  const verifyDir = join(stagingRoot, "restore-checks", runId);
  await rm(verifyDir, { recursive: true, force: true });
  await mkdir(verifyDir, { recursive: true });

  try {
    const microsoftCreds = await getMicrosoftCredentials(db, String(destination.config.microsoftIntegrationId ?? ""));
    const localArtifact = await downloadArtifact(destination, artifact, verifyDir, log, microsoftCreds);
    await verifyChecksum(localArtifact, artifact, log);
    const checkedArtifacts = source.type === "postgres"
      ? await verifyPostgresRestore(source, policy, runId, localArtifact, log)
      : await verifyMinioRestore(localArtifact, verifyDir, log);
    const verifiedAt = now();
    await db.updateRun(run.id, {
      status: "recoverable",
      verificationStatus: "restore_verified",
      verifiedAt,
      errorCode: null,
      errorMessage: null,
    });
    await log("info", "Restore verification passed", { checkedArtifacts });
    return { runId, status: "recoverable", verificationStatus: "restore_verified", checkedArtifacts, message: "Restore automatico validado" };
  } catch (error: any) {
    await db.updateRun(run.id, {
      status: "restore_failed",
      verificationStatus: "integrity_verified",
      errorCode: "RESTORE_VERIFICATION_FAILED",
      errorMessage: error.message,
    });
    await log("error", "Restore verification failed", { error: error.message });
    return { runId, status: "restore_failed", verificationStatus: "integrity_verified", checkedArtifacts: 0, message: error.message };
  } finally {
    await rm(verifyDir, { recursive: true, force: true });
    await log("info", "Restore verification workspace cleaned");
  }
}

async function loadContext(db: AppDb, runId: string) {
  const run = await db.getRun(runId);
  if (!run) throw new Error("Run not found");
  const source = await db.getSource(run.sourceId);
  const policy = await db.getPolicy(run.policyId);
  const destination = await db.getDestination(run.destinationId);
  if (!source || !policy || !destination) throw new Error("Run policy, source or destination not found");
  const artifacts = await db.listArtifacts(run.id);
  const artifact = artifacts.find((item) => item.kind !== "manifest");
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

async function getMicrosoftCredentials(db: AppDb, integrationId?: string) {
  const integrations = await db.listMicrosoftIntegrations();
  const settings = await db.getSettings();
  const saved = integrationId
    ? integrations.find((item: any) => item.id === integrationId) ?? settings.microsoft
    : settings.microsoft ?? integrations[0];
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
  const cfg = source.config as any;
  const scope = resolvePolicyScope(source, policy);
  if (scope.mode === "all") throw new Error("Automatic restore verification for PostgreSQL all-databases scope is not supported safely yet");
  const database = `snapvault_verify_${runId.replace(/[^a-zA-Z0-9_]/g, "_")}`.toLowerCase();
  const env = { PGPASSWORD: source.secrets.password ?? "" };
  await runCommand("dropdb", ["-h", String(cfg.host), "-p", String(cfg.port ?? 5432), "-U", String(cfg.username), "--if-exists", database], env);
  const created = await runCommand("createdb", ["-h", String(cfg.host), "-p", String(cfg.port ?? 5432), "-U", String(cfg.username), database], env);
  if (created.code !== 0) throw new Error(created.stderr || "temporary restore database creation failed");
  try {
    const restore = await runCommand("sh", ["-c", `gzip -cd "$1" | psql -h "$2" -p "$3" -U "$4" -d "$5" >/dev/null`, "sh", localFile, String(cfg.host), String(cfg.port ?? 5432), String(cfg.username), database], env);
    if (restore.code !== 0) throw new Error(restore.stderr || "postgres restore failed");
    const probe = await runCommand("psql", ["-h", String(cfg.host), "-p", String(cfg.port ?? 5432), "-U", String(cfg.username), "-d", database, "-tAc", "select count(*) from pg_class where relkind in ('r','v','m','S','f','p')"], env);
    if (probe.code !== 0) throw new Error(probe.stderr || "postgres restore validation failed");
    const objectCount = Number(probe.stdout.trim());
    if (!Number.isFinite(objectCount) || objectCount <= 0) throw new Error("postgres restore produced no database objects");
    await log("info", "PostgreSQL restore verified in temporary database", { database, objectCount });
    return objectCount;
  } finally {
    await runCommand("dropdb", ["-h", String(cfg.host), "-p", String(cfg.port ?? 5432), "-U", String(cfg.username), "--if-exists", database], env);
    await log("info", "PostgreSQL temporary restore database removed", { database });
  }
}

function resolvePolicyScope(source: Source, policy: any) {
  const scope = policy.sourceScope as any;
  if (scope?.mode) return scope;
  const cfg = source.config as any;
  if (source.type === "postgres") return { mode: cfg.scope === "all" ? "all" : "single", database: cfg.database };
  return { mode: cfg.scope === "all" ? "all" : "single", bucket: cfg.bucket, prefix: cfg.prefix ?? "" };
}

async function verifyMinioRestore(localFile: string, verifyDir: string, log: Logger) {
  const extractDir = join(verifyDir, "minio-extracted");
  await mkdir(extractDir, { recursive: true });
  const gzip = await runCommand("gzip", ["-t", localFile]);
  if (gzip.code !== 0) throw new Error(gzip.stderr || "minio snapshot gzip check failed");
  const tar = await runCommand("tar", ["-xzf", localFile, "-C", extractDir]);
  if (tar.code !== 0) throw new Error(tar.stderr || "minio snapshot extraction failed");
  const count = await runCommand("sh", ["-c", `find "$1" -type f -printf '.' | wc -c`, "sh", extractDir]);
  if (count.code !== 0) throw new Error(count.stderr || "minio snapshot file listing failed");
  const fileCount = Number(count.stdout.trim());
  if (!Number.isFinite(fileCount) || fileCount <= 0) throw new Error("minio snapshot contains no files");
  await log("info", "MinIO snapshot restore verified in temporary workspace", { files: fileCount });
  return fileCount;
}
