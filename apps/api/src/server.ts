import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import bcrypt from "bcryptjs";
import { basename } from "node:path";
import { z } from "zod";
import { config } from "./config.js";
import { decryptText, encryptText } from "./crypto.js";
import { id, now } from "./ids.js";
import { publicMicrosoftConfig, publicUser, Store, withoutSecrets } from "./store.js";
import { executeBackupRun } from "./backup.js";
import { getMicrosoftDriveQuota, listMicrosoftSiteDrives, listMicrosoftSites, listMicrosoftUsers, microsoftCredentialStatus, testMicrosoftDestination } from "./microsoftGraph.js";
import { verifyRestoreForRun } from "./restoreVerify.js";

const store = new Store(config.databasePath);
const app = Fastify({ logger: true });

await app.register(cors, { origin: config.webOrigin, credentials: true });
await app.register(cookie, { secret: config.cookieSecret });

const sourceSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["postgres", "minio"]),
  config: z.record(z.unknown()),
  secrets: z.record(z.string()).default({})
});

const destinationSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["onedrive", "sharepoint", "s3", "azure_blob", "google_drive", "dropbox", "b2", "wasabi", "ftp", "sftp"]),
  basePath: z.string().default("/SnapVault"),
  config: z.record(z.unknown()),
  metadata: z.record(z.unknown()).optional(),
  secrets: z.record(z.string()).default({})
});

const policySchema = z.object({
  name: z.string().min(1),
  sourceId: z.string(),
  destinationId: z.string(),
  schedule: z.object({
    type: z.enum(["daily", "weekly", "cron"]),
    cron: z.string().optional(),
    time: z.string().optional(),
    weekday: z.number().optional(),
    timezone: z.string().default("America/Sao_Paulo")
  }),
  retention: z.object({ keepLast: z.number().int().min(1), keepDays: z.number().int().min(0) }),
  options: z.object({
    compression: z.enum(["gzip", "zstd"]),
    encryption: z.boolean(),
    verifyAfterUpload: z.boolean()
  }),
  enabled: z.boolean()
});

const sourcePatchSchema = z.object({
  name: z.string().min(1).optional()
});

const destinationPatchSchema = z.object({
  name: z.string().min(1).optional(),
  basePath: z.string().min(1).optional(),
  config: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional()
});

const microsoftConfigSchema = z.object({
  tenantId: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1).optional()
});

const policyPatchSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional()
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const message = error instanceof Error ? error.message : "Request failed";
  reply.status(400).send({ error: { code: "REQUEST_FAILED", message, details: {} } });
});

app.get("/health", async () => ({ status: "ok" }));
app.get("/ready", async () => ({ status: "ready" }));

app.get("/api/v1/setup/status", async () => {
  const db = await store.read();
  return { requiresSetup: db.users.length === 0 };
});

app.post("/api/v1/setup/admin", async (request, reply) => {
  const body = z.object({ name: z.string().min(1), email: z.string().email(), password: z.string().min(8) }).parse(request.body);
  const user = await store.update(async (db) => {
    if (db.users.length > 0) throw new Error("Setup already completed");
    const created = now();
    const next = { id: id("user"), name: body.name, email: body.email.toLowerCase(), passwordHash: await bcrypt.hash(body.password, 12), role: "admin" as const, createdAt: created, updatedAt: created };
    db.users.push(next);
    return next;
  });
  await createSession(reply, user.id);
  return { user: publicUser(user) };
});

app.post("/api/v1/auth/login", async (request, reply) => {
  const body = z.object({ email: z.string().email(), password: z.string() }).parse(request.body);
  const db = await store.read();
  const user = db.users.find((item) => item.email === body.email.toLowerCase());
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
    return reply.status(401).send({ error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password", details: {} } });
  }
  await createSession(reply, user.id);
  return { user: publicUser(user) };
});

app.post("/api/v1/auth/logout", async (request, reply) => {
  const sessionId = request.cookies.snapvault_session;
  if (sessionId) {
    await store.update((db) => {
      db.sessions = db.sessions.filter((item) => item.id !== sessionId);
    });
  }
  reply.clearCookie("snapvault_session", { path: "/" });
  return { ok: true };
});

app.get("/api/v1/auth/me", { preHandler: requireAuth }, async (request) => ({ user: publicUser((request as any).user) }));

app.get("/api/v1/integrations/microsoft/config", { preHandler: requireAuth }, async () => {
  const db = await store.read();
  const saved = publicMicrosoftConfig(db.settings);
  if (saved.configured) return saved;
  return {
    ...saved,
    configured: Boolean(config.microsoft.tenantId && config.microsoft.clientId && config.microsoft.clientSecret),
    tenantId: config.microsoft.tenantId,
    clientId: config.microsoft.clientId,
    clientSecretSet: Boolean(config.microsoft.clientSecret),
    source: config.microsoft.clientSecret ? "env" : "none"
  };
});

app.put("/api/v1/integrations/microsoft/config", { preHandler: requireAuth }, async (request) => {
  const body = microsoftConfigSchema.parse(request.body);
  const saved = await store.update((db) => {
    const previous = db.settings?.microsoft;
    const clientSecret = body.clientSecret
      ? body.clientSecret
      : previous?.encryptedClientSecret
        ? decryptText(previous.encryptedClientSecret, config.cookieSecret)
        : config.microsoft.clientSecret;
    if (!clientSecret) throw new Error("Client secret is required");
    const stamp = now();
    db.settings = db.settings ?? {};
    db.settings.microsoft = {
      tenantId: body.tenantId,
      clientId: body.clientId,
      encryptedClientSecret: encryptText(clientSecret, config.cookieSecret),
      status: "untested",
      lastTestedAt: previous?.lastTestedAt ?? null,
      createdAt: previous?.createdAt ?? stamp,
      updatedAt: stamp
    };
    return publicMicrosoftConfig(db.settings);
  });
  return saved;
});

app.post("/api/v1/integrations/microsoft/test", { preHandler: requireAuth }, async () => {
  const credentials = await microsoftCredentials();
  const result = await microsoftCredentialStatus(credentials);
  const updated = await store.update((db) => {
    if (db.settings?.microsoft) {
      db.settings.microsoft.status = "healthy";
      db.settings.microsoft.lastTestedAt = now();
      db.settings.microsoft.updatedAt = now();
    }
    return publicMicrosoftConfig(db.settings);
  });
  return { ...result, config: updated };
});

app.get("/api/v1/integrations/microsoft/status", { preHandler: requireAuth }, async () => microsoftCredentialStatus(await microsoftCredentials()));
app.get("/api/v1/integrations/microsoft/users", { preHandler: requireAuth }, async () => listMicrosoftUsers(await microsoftCredentials()));
app.get("/api/v1/integrations/microsoft/sites", { preHandler: requireAuth }, async () => listMicrosoftSites(await microsoftCredentials()));
app.get("/api/v1/integrations/microsoft/site-drives", { preHandler: requireAuth }, async (request) => {
  const query = z.object({ siteId: z.string() }).parse(request.query);
  return listMicrosoftSiteDrives(query.siteId, await microsoftCredentials());
});
app.get("/api/v1/integrations/microsoft/drive-quota", { preHandler: requireAuth }, async (request) => {
  const query = z.object({ driveId: z.string() }).parse(request.query);
  return getMicrosoftDriveQuota(query.driveId, await microsoftCredentials());
});

app.get("/api/v1/sources", { preHandler: requireAuth }, async () => {
  const db = await store.read();
  return { sources: db.sources.map(withoutSecrets) };
});

app.post("/api/v1/sources", { preHandler: requireAuth }, async (request) => {
  const body = sourceSchema.parse(request.body);
  const created = now();
  const source = { id: id("src"), ...body, status: "untested" as const, lastTestedAt: null, createdAt: created, updatedAt: created };
  await store.update((db) => {
    db.sources.push(source);
  });
  return { source: withoutSecrets(source) };
});

app.post("/api/v1/sources/:id/test", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  return markResource("source", params.id);
});

app.patch("/api/v1/sources/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = sourcePatchSchema.parse(request.body);
  const source = await store.update((db) => {
    const target = db.sources.find((item) => item.id === params.id);
    if (!target) throw new Error("Source not found");
    Object.assign(target, body, { updatedAt: now() });
    return withoutSecrets(target);
  });
  return { source };
});

app.delete("/api/v1/sources/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  await store.update((db) => {
    if (db.policies.some((item) => item.sourceId === params.id)) throw new Error("Source is used by a backup routine");
    db.sources = db.sources.filter((item) => item.id !== params.id);
  });
  return { ok: true };
});

app.get("/api/v1/destinations", { preHandler: requireAuth }, async () => {
  const db = await store.read();
  return { destinations: db.destinations.map(withoutSecrets) };
});

app.post("/api/v1/destinations", { preHandler: requireAuth }, async (request) => {
  const body = destinationSchema.parse(request.body);
  const created = now();
  const destination = { id: id("dst"), ...body, status: "untested" as const, lastTestedAt: null, createdAt: created, updatedAt: created };
  await store.update((db) => {
    db.destinations.push(destination);
  });
  return { destination: withoutSecrets(destination) };
});

app.post("/api/v1/destinations/:id/test", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const db = await store.read();
  const destination = db.destinations.find((item) => item.id === params.id);
  if (!destination) throw new Error("destination not found");
  if (destination.status === "archived") throw new Error("Archived storage cannot be tested until it is reactivated");
  if ((destination.type === "onedrive" || destination.type === "sharepoint") && destination.config.mode === "graph") {
    const result = await testMicrosoftDestination(destination.config as any, destination.basePath, await microsoftCredentials());
    await markResource("destination", params.id, { quota: result.quota, checked: result.checked, drive: result.drive });
    return result;
  }
  return markResource("destination", params.id);
});

app.patch("/api/v1/destinations/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = destinationPatchSchema.parse(request.body);
  const destination = await store.update((db) => {
    const target = db.destinations.find((item) => item.id === params.id);
    if (!target) throw new Error("Destination not found");
    Object.assign(target, body, { updatedAt: now() });
    return withoutSecrets(target);
  });
  return { destination };
});

app.delete("/api/v1/destinations/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  await store.update((db) => {
    if (db.policies.some((item) => item.destinationId === params.id)) throw new Error("Destination is used by a backup routine");
    if (db.runs.some((item) => item.destinationId === params.id) || db.artifacts.some((item) => item.destinationId === params.id)) throw new Error("Destination has backup history; archive it instead");
    db.destinations = db.destinations.filter((item) => item.id !== params.id);
  });
  return { ok: true };
});

app.post("/api/v1/destinations/:id/archive", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const destination = await store.update((db) => {
    const target = db.destinations.find((item) => item.id === params.id);
    if (!target) throw new Error("Destination not found");
    target.status = "archived";
    target.archivedAt = now();
    target.updatedAt = now();
    for (const policy of db.policies.filter((item) => item.destinationId === params.id)) {
      policy.enabled = false;
      policy.updatedAt = now();
    }
    return withoutSecrets(target);
  });
  return { destination };
});

app.post("/api/v1/destinations/:id/reactivate", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const destination = await store.update((db) => {
    const target = db.destinations.find((item) => item.id === params.id);
    if (!target) throw new Error("Destination not found");
    target.status = "untested";
    target.archivedAt = null;
    target.updatedAt = now();
    return withoutSecrets(target);
  });
  return { destination };
});

app.get("/api/v1/policies", { preHandler: requireAuth }, async () => {
  const db = await store.read();
  return { policies: db.policies };
});

app.post("/api/v1/policies", { preHandler: requireAuth }, async (request) => {
  const body = policySchema.parse(request.body);
  const created = now();
  const policy = { id: id("pol"), ...body, createdAt: created, updatedAt: created };
  await store.update((db) => {
    if (!db.sources.some((item) => item.id === body.sourceId)) throw new Error("Source not found");
    const destination = db.destinations.find((item) => item.id === body.destinationId);
    if (!destination) throw new Error("Destination not found");
    if (destination.status !== "healthy") throw new Error("Destination must be tested and healthy before creating a backup routine");
    db.policies.push(policy);
  });
  return { policy };
});

app.patch("/api/v1/policies/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = policyPatchSchema.parse(request.body);
  const policy = await store.update((db) => {
    const target = db.policies.find((item) => item.id === params.id);
    if (!target) throw new Error("Policy not found");
    Object.assign(target, body, { updatedAt: now() });
    return target;
  });
  return { policy };
});

app.delete("/api/v1/policies/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  await store.update((db) => {
    db.policies = db.policies.filter((item) => item.id !== params.id);
  });
  return { ok: true };
});

app.post("/api/v1/policies/:id/run", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const run = await store.update((db) => {
    const policy = db.policies.find((item) => item.id === params.id);
    if (!policy) throw new Error("Policy not found");
    const destination = db.destinations.find((item) => item.id === policy.destinationId);
    if (!destination) throw new Error("Destination not found");
    if (destination.status !== "healthy") throw new Error("Destination must be healthy before running a backup");
    const created: any = { id: id("run"), policyId: policy.id, sourceId: policy.sourceId, destinationId: policy.destinationId, trigger: "manual", status: "queued", startedAt: null, finishedAt: null, durationMs: null, bytesWritten: null, errorCode: null, errorMessage: null, verificationStatus: "not_checked", verifiedAt: null, createdAt: now() };
    db.runs.push(created);
    return created;
  });
  void executeBackupRun(store, run.id, config.stagingDir);
  return { runId: run.id, status: run.status };
});

app.get("/api/v1/runs", { preHandler: requireAuth }, async () => {
  const db = await store.read();
  return { runs: [...db.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
});

app.get("/api/v1/runs/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const db = await store.read();
  return {
    run: db.runs.find((item) => item.id === params.id),
    logs: db.logs.filter((item) => item.runId === params.id),
    artifacts: db.artifacts.filter((item) => item.runId === params.id)
  };
});

app.post("/api/v1/runs/:id/test-restore", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  return verifyRestoreForRun(store, params.id, config.stagingDir);
});

app.post("/api/v1/restores/prepare", { preHandler: requireAuth }, async (request) => {
  const body = z.object({ artifactId: z.string() }).parse(request.body);
  const db = await store.read();
  const artifact = db.artifacts.find((item) => item.id === body.artifactId);
  if (!artifact) throw new Error("Artifact not found");
  const run = db.runs.find((item) => item.id === artifact.runId);
  const source = run ? db.sources.find((item) => item.id === run.sourceId) : null;
  const command = source?.type === "postgres"
    ? "baixe o arquivo, descompacte se necessario e restaure com pg_restore/psql conforme o formato gerado"
    : "baixe o pacote, extraia o conteudo e envie os arquivos para o bucket MinIO desejado";
  return {
    restore: {
      id: id("rst"),
      status: "ready",
      artifact: { id: artifact.id, name: basename(artifact.path), sizeBytes: artifact.sizeBytes, checksum: artifact.checksumSha256, remotePath: artifact.path },
      sourceType: source?.type ?? "unknown",
      instructions: command
    }
  };
});

async function createSession(reply: any, userId: string) {
  const session = { id: id("sess"), userId, createdAt: now(), expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString() };
  await store.update((db) => {
    db.sessions.push(session);
  });
  reply.setCookie("snapvault_session", session.id, { path: "/", httpOnly: true, sameSite: "lax" });
}

async function requireAuth(request: any, reply: any) {
  const sessionId = request.cookies.snapvault_session;
  if (!sessionId) return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Login required", details: {} } });
  const db = await store.read();
  const session = db.sessions.find((item) => item.id === sessionId && Date.parse(item.expiresAt) > Date.now());
  const user = session ? db.users.find((item) => item.id === session.userId) : null;
  if (!user) return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Login required", details: {} } });
  request.user = user;
}

async function markResource(kind: "source" | "destination", resourceId: string, metadata?: Record<string, unknown>) {
  const updated = await store.update((db) => {
    const collection = kind === "source" ? db.sources : db.destinations;
    const target = collection.find((item) => item.id === resourceId);
    if (!target) throw new Error(`${kind} not found`);
    target.status = "healthy";
    target.lastTestedAt = now();
    target.updatedAt = now();
    if (metadata && kind === "destination") (target as any).metadata = { ...((target as any).metadata ?? {}), ...metadata };
    return withoutSecrets(target);
  });
  return { status: "healthy", resource: updated };
}

async function microsoftCredentials() {
  const db = await store.read();
  const saved = db.settings?.microsoft;
  if (saved?.tenantId && saved?.clientId && saved?.encryptedClientSecret) {
    return { tenantId: saved.tenantId, clientId: saved.clientId, clientSecret: decryptText(saved.encryptedClientSecret, config.cookieSecret) };
  }
  if (config.microsoft.tenantId && config.microsoft.clientId && config.microsoft.clientSecret) return config.microsoft;
  throw new Error("Microsoft credentials are not configured");
}

await app.listen({ host: config.host, port: config.port });
