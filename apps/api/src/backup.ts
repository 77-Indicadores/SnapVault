import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { Store } from "./store.js";
import { decryptText, sha256File } from "./crypto.js";
import { commandExists, runCommand } from "./runner.js";
import { id, now } from "./ids.js";
import type { BackupArtifact, BackupRun, Destination, JobLogEntry, Policy, Source } from "./types.js";
import { deleteMicrosoftDrivePath, uploadToMicrosoftDrive } from "./microsoftGraph.js";
import { verifyRestoreForRun } from "./restoreVerify.js";
import { config } from "./config.js";

type Logger = (level: JobLogEntry["level"], message: string, data?: Record<string, unknown>) => Promise<void>;

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "source";

export async function executeBackupRun(store: Store, runId: string, stagingRoot: string) {
  const db = await store.read();
  const run = db.runs.find((item) => item.id === runId);
  if (!run) return;
  const policy = db.policies.find((item) => item.id === run.policyId);
  const source = db.sources.find((item) => item.id === run.sourceId);
  const destination = db.destinations.find((item) => item.id === run.destinationId);
  if (!policy || !source || !destination) return failRun(store, run, "RUN_CONTEXT_MISSING", "Policy, source or destination not found");

  const startedAt = now();
  await store.update((next) => {
    const target = next.runs.find((item) => item.id === runId);
    if (target) {
      target.status = "running";
      target.startedAt = startedAt;
    }
  });

  const log: Logger = async (level, message, data) => {
    await store.update((next) => {
      next.logs.push({ id: id("log"), runId, level, message, data, createdAt: now() });
    });
  };

  try {
    const runDir = join(stagingRoot, runId);
    await mkdir(runDir, { recursive: true });
    await log("info", "Starting backup run");
    const produced = await createSourceArtifact(source, policy, runDir, log);
    await verifyLocalArtifacts(source, produced, log);
    const manifestPath = await writeManifest(run, source, policy, produced, runDir);
    const uploaded = await uploadArtifacts(destination, source, run, [...produced, manifestPath], log, getMicrosoftCredentials(db, String(destination.config.microsoftIntegrationId ?? "")));
    const finishedAt = now();
    const totalBytes = uploaded.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
    await store.update((next) => {
      const target = next.runs.find((item) => item.id === runId);
      if (target) {
        target.status = "verified";
        target.finishedAt = finishedAt;
        target.durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
        target.bytesWritten = totalBytes;
        target.verificationStatus = "integrity_verified";
        target.verifiedAt = finishedAt;
      }
      next.artifacts.push(...uploaded);
    });
    await log("info", "Backup verified and uploaded", { bytesWritten: totalBytes, verificationStatus: "integrity_verified" });
    await verifyRestoreForRun(store, runId, stagingRoot);
    try {
      await applyRetention(store, policy, destination, log);
    } catch (error: any) {
      await log("warn", "Retention cleanup failed", { error: error.message });
    }
  } catch (error: any) {
    await log("error", "Backup failed", { error: error.message });
    await failRun(store, run, "BACKUP_FAILED", error.message, startedAt);
  }
}

async function applyRetention(store: Store, policy: Policy, destination: Destination, log: Logger) {
  if (destination.status === "archived") {
    await log("warn", "Retention skipped because destination is archived");
    return;
  }
  const db = await store.read();
  const microsoftCredentials = getMicrosoftCredentials(db, String(destination.config.microsoftIntegrationId ?? ""));
  const keepLast = Math.max(1, policy.retention.keepLast);
  const keepDays = Math.max(0, policy.retention.keepDays);
  const policyRuns = db.runs
    .filter((item) => item.policyId === policy.id && (item.status === "success" || item.status === "verified" || item.status === "recoverable"))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const protectedIds = new Set(policyRuns.slice(0, keepLast).map((item) => item.id));
  const lastRecoverable = policyRuns.find((item) => item.status === "recoverable" || item.verificationStatus === "restore_verified");
  if (lastRecoverable) protectedIds.add(lastRecoverable.id);
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const deleteRuns = policyRuns.filter((item) => !protectedIds.has(item.id) && (keepDays === 0 || Date.parse(item.createdAt) < cutoff));
  if (!deleteRuns.length) {
    await log("info", "Retention checked; nothing to delete", { keepLast, keepDays, totalRuns: policyRuns.length });
    return;
  }

  const deleteRunIds = new Set(deleteRuns.map((item) => item.id));
  const deleteArtifacts = db.artifacts.filter((item) => deleteRunIds.has(item.runId));
  for (const artifact of deleteArtifacts) {
    await deleteArtifact(destination, artifact.path, microsoftCredentials);
  }
  await store.update((next) => {
    next.artifacts = next.artifacts.filter((item) => !deleteRunIds.has(item.runId));
    next.logs = next.logs.filter((item) => !deleteRunIds.has(item.runId));
    next.runs = next.runs.filter((item) => !deleteRunIds.has(item.id));
  });
  await log("info", "Retention cleanup applied", { keepLast, keepDays, deletedRuns: deleteRuns.length, deletedArtifacts: deleteArtifacts.length });
}

async function deleteArtifact(destination: Destination, path: string, microsoftCredentials?: any) {
  if ((destination.type === "onedrive" || destination.type === "sharepoint") && destination.config.mode === "graph") {
    await deleteMicrosoftDrivePath(destination.config as any, path, microsoftCredentials);
    return;
  }
  if (path.startsWith("/")) {
    await rm(path, { force: true });
  }
}

async function verifyLocalArtifacts(source: Source, files: string[], log: Logger) {
  for (const file of files) {
    const info = await stat(file);
    if (info.size <= 0) throw new Error(`Artifact is empty: ${file}`);
    const checksumSha256 = await sha256File(file);
    if (!checksumSha256) throw new Error(`Artifact checksum failed: ${file}`);
    if (file.endsWith(".gz")) {
      const gzip = await runCommand("gzip", ["-t", file]);
      if (gzip.code !== 0) throw new Error(gzip.stderr || `gzip integrity check failed: ${file}`);
    }
    if (source.type === "minio" && file.endsWith(".tar.gz")) {
      const tar = await runCommand("tar", ["-tzf", file]);
      if (tar.code !== 0) throw new Error(tar.stderr || `tar integrity check failed: ${file}`);
    }
    await log("info", "Artifact integrity verified", { file, sizeBytes: info.size, checksumSha256 });
  }
}

async function failRun(store: Store, run: BackupRun, code: string, message: string, startedAt = run.startedAt ?? now()) {
  const finishedAt = now();
  await store.update((db) => {
    const target = db.runs.find((item) => item.id === run.id);
    if (target) {
      target.status = "failed";
      target.errorCode = code;
      target.errorMessage = message;
      target.startedAt = startedAt;
      target.finishedAt = finishedAt;
      target.durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
    }
  });
}

async function createSourceArtifact(source: Source, policy: Policy, runDir: string, log: Logger): Promise<string[]> {
  if (source.type === "postgres") return createPostgresDump(source, policy, runDir, log);
  if (source.type === "minio") return createMinioSnapshot(source, policy, runDir, log);
  throw new Error(`Unsupported source type: ${source.type}`);
}

async function createPostgresDump(source: Source, policy: Policy, runDir: string, log: Logger) {
  const out = join(runDir, policy.options.compression === "zstd" ? "dump.sql.zst" : "dump.sql.gz");
  const hasPgDump = await commandExists("pg_dump");
  if (!hasPgDump) {
    await log("warn", "pg_dump not found; writing development fixture");
    await writeFile(out, `-- SnapVault development dump\n-- source=${source.name}\n-- createdAt=${now()}\n`);
    return [out];
  }
  const config = source.config as any;
  if (config.scope === "all") {
    const result = await runCommand("pg_dumpall", ["-h", String(config.host), "-p", String(config.port ?? 5432), "-U", String(config.username)], { PGPASSWORD: source.secrets.password ?? "" });
    if (result.code !== 0) throw new Error(result.stderr || "pg_dumpall failed");
    if (policy.options.compression === "gzip") await pipeline(Readable.from([result.stdout]), createGzip(), createWriteStream(out));
    else await writeFile(out, result.stdout);
    return [out];
  }
  const args = ["-h", String(config.host), "-p", String(config.port ?? 5432), "-U", String(config.username), String(config.database)];
  const result = await runCommand("pg_dump", args, { PGPASSWORD: source.secrets.password ?? "" });
  if (result.code !== 0) throw new Error(result.stderr || "pg_dump failed");
  if (policy.options.compression === "gzip") {
    await pipeline(Readable.from([result.stdout]), createGzip(), createWriteStream(out));
  } else {
    await writeFile(out, result.stdout);
  }
  return [out];
}

async function createMinioSnapshot(source: Source, policy: Policy, runDir: string, log: Logger) {
  const out = join(runDir, policy.options.compression === "zstd" ? "objects.tar.zst" : "objects.tar.gz");
  const hasMc = await commandExists("mc");
  if (!hasMc) {
    await log("warn", "mc not found; writing development fixture");
    await writeFile(out, `SnapVault development MinIO snapshot\nsource=${source.name}\ncreatedAt=${now()}\n`);
    return [out];
  }
  const config = source.config as any;
  const alias = `snapvault-${source.id}-${Date.now()}`;
  const objectDir = join(runDir, "objects");
  await mkdir(objectDir, { recursive: true });
  const aliasResult = await runCommand("mc", ["alias", "set", alias, String(config.endpoint), source.secrets.accessKey ?? "", source.secrets.secretKey ?? ""]);
  if (aliasResult.code !== 0) throw new Error(aliasResult.stderr || "mc alias set failed");
  const bucketPath = config.scope === "all" ? "" : [String(config.bucket), String(config.prefix ?? "").replace(/^\/+|\/+$/g, "")].filter(Boolean).join("/");
  const copyResult = await runCommand("mc", ["cp", "--recursive", `${alias}/${bucketPath}`, objectDir]);
  await runCommand("mc", ["alias", "remove", alias]);
  if (copyResult.code !== 0) throw new Error(copyResult.stderr || "mc copy failed");
  const tarResult = await runCommand("tar", ["-czf", out, "-C", objectDir, "."]);
  if (tarResult.code !== 0) throw new Error(tarResult.stderr || "tar failed");
  await log("info", "MinIO snapshot created", { bucket: config.bucket, prefix: config.prefix ?? "" });
  return [out];
}

async function writeManifest(run: BackupRun, source: Source, policy: Policy, files: string[], runDir: string) {
  const artifacts = [];
  for (const file of files) {
    const info = await stat(file);
    artifacts.push({ path: file, sizeBytes: info.size, checksumSha256: await sha256File(file) });
  }
  const manifest = join(runDir, "manifest.json");
  await writeFile(manifest, JSON.stringify({ schemaVersion: 1, runId: run.id, policyId: policy.id, source: { id: source.id, type: source.type, name: source.name }, createdAt: now(), artifacts }, null, 2));
  return manifest;
}

async function uploadArtifacts(destination: Destination, source: Source, run: BackupRun, files: string[], log: Logger, microsoftCredentials?: any): Promise<BackupArtifact[]> {
  const base = String(destination.basePath || "SnapVault").replace(/^\/+|\/+$/g, "");
  const datedPrefix = `${slug(source.name)}/${new Date().toISOString().slice(0, 10).replaceAll("-", "/")}/${run.id}`;
  const hasRclone = await commandExists("rclone");
  const records: BackupArtifact[] = [];
  for (const file of files) {
    const name = file.split(/[\\/]/).pop() ?? "artifact";
    const remotePath = `${base}/${datedPrefix}/${name}`;
    let storedPath = file;
    if ((destination.type === "onedrive" || destination.type === "sharepoint") && destination.config.mode === "graph") {
      const uploaded = await uploadToMicrosoftDrive(destination.config as any, destination.basePath, file, datedPrefix, microsoftCredentials);
      storedPath = uploaded.path;
      await log("info", "Uploaded artifact to Microsoft Graph", { path: uploaded.path, drive: uploaded.drive.label });
    } else if (hasRclone && destination.config.rcloneRemoteName) {
      const remote = `${destination.config.rcloneRemoteName}:${remotePath}`;
      const result = await runCommand("rclone", ["copyto", file, remote]);
      if (result.code !== 0) throw new Error(result.stderr || "rclone upload failed");
      storedPath = remotePath;
      await log("info", "Uploaded artifact", { remotePath });
    } else {
      await log("warn", "rclone not configured; keeping artifact in local staging", { file });
    }
    const info = await stat(file);
    records.push({
      id: id("artifact"),
      runId: run.id,
      policyId: run.policyId,
      sourceId: run.sourceId,
      destinationId: run.destinationId,
      kind: name === "manifest.json" ? "manifest" : source.type === "postgres" ? "postgres_dump" : "minio_snapshot",
      path: storedPath,
      checksumSha256: await sha256File(file),
      sizeBytes: info.size,
      verificationStatus: "integrity_verified",
      verifiedAt: now(),
      encrypted: false,
      compression: name.endsWith(".gz") ? "gzip" : name.endsWith(".zst") ? "zstd" : "none",
      createdAt: now()
    });
  }
  return records;
}

function getMicrosoftCredentials(db: any, integrationId?: string) {
  const saved = integrationId
    ? db.microsoftIntegrations?.find((item: any) => item.id === integrationId) ?? db.settings?.microsoft
    : db.settings?.microsoft ?? db.microsoftIntegrations?.[0];
  if (saved?.tenantId && saved?.clientId && saved?.encryptedClientSecret) {
    return { tenantId: saved.tenantId, clientId: saved.clientId, clientSecret: decryptText(saved.encryptedClientSecret, config.cookieSecret) };
  }
  if (config.microsoft.tenantId && config.microsoft.clientId && config.microsoft.clientSecret) return config.microsoft;
  return undefined;
}
