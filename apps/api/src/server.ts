import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import bcrypt from "bcryptjs";
import { basename } from "node:path";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { config } from "./config.js";
import { decryptText, encryptText } from "./crypto.js";
import { id, now } from "./ids.js";
import { publicMicrosoftConfig, publicUser, Store, withoutSecrets } from "./store.js";
import { executeBackupRun } from "./backup.js";
import { getMicrosoftDriveQuota, listMicrosoftSiteDrives, listMicrosoftSites, listMicrosoftUsers, microsoftCredentialStatus, testMicrosoftDestination } from "./microsoftGraph.js";
import { verifyRestoreForRun } from "./restoreVerify.js";
import { runCommand } from "./runner.js";

const store = new Store(config.databasePath);

// Token: env var tem prioridade; fallback para o valor salvo no banco
const dbForLogger = await store.read();
const betterstackToken = config.betterstackToken || dbForLogger.settings?.betterstack?.token || "";

const loggerOptions = betterstackToken
  ? {
      level: "info",
      transport: {
        targets: [
          { target: "pino/file", options: { destination: 1 }, level: "info" },
          { target: "@logtail/pino", options: { sourceToken: betterstackToken }, level: "info" }
        ]
      }
    }
  : { level: "info" };

const app = Fastify({ logger: loggerOptions as any });
const scheduledKeys = new Set<string>();

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
  sourceScope: z.object({
    mode: z.enum(["single", "all"]),
    database: z.string().optional(),
    bucket: z.string().optional(),
    prefix: z.string().optional()
  }).optional(),
  schedule: z.object({
    type: z.enum(["manual", "daily", "weekly", "cron"]),
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
  name: z.string().min(1).optional(),
  config: z.record(z.unknown()).optional(),
  secrets: z.record(z.string()).optional()
});

const destinationPatchSchema = z.object({
  name: z.string().min(1).optional(),
  basePath: z.string().min(1).optional(),
  config: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional()
});

const microsoftConfigSchema = z.object({
  name: z.string().min(1).default("Microsoft"),
  tenantId: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1).optional()
});

const policyPatchSchema = z.object({
  name: z.string().min(1).optional(),
  sourceId: z.string().optional(),
  destinationId: z.string().optional(),
  sourceScope: policySchema.shape.sourceScope,
  schedule: policySchema.shape.schedule.optional(),
  retention: policySchema.shape.retention.optional(),
  options: policySchema.shape.options.optional(),
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

app.post("/api/v1/admin/restart", { preHandler: requireAuth }, async (_request, reply) => {
  reply.send({ ok: true, message: "Reinicio solicitado..." });
  setImmediate(() => {
    if (process.send) {
      // Modo cluster: delega o rolling restart ao master
      process.send({ type: "restart" });
    } else {
      // Modo dev (sem master): shutdown normal
      gracefulShutdown("restart solicitado pelo usuario via painel");
    }
  });
});

app.get("/api/v1/settings", { preHandler: requireAuth }, async () => {
  const db = await store.read();
  return { timezone: db.settings?.timezone ?? "America/Sao_Paulo" };
});

app.patch("/api/v1/settings", { preHandler: requireAuth }, async (request) => {
  const body = z.object({ timezone: z.string().min(1) }).parse(request.body);
  const result = await store.update((db) => {
    db.settings = db.settings ?? { microsoft: null, timezone: "America/Sao_Paulo" };
    db.settings.timezone = body.timezone;
    return { timezone: db.settings.timezone };
  });
  return result;
});

app.get("/api/v1/integrations/betterstack", { preHandler: requireAuth }, async () => {
  const db = await store.read();
  const bs = db.settings?.betterstack;
  return { configured: Boolean(bs?.token), ingestingHost: bs?.ingestingHost ?? "", tokenSet: Boolean(bs?.token) };
});

app.patch("/api/v1/integrations/betterstack", { preHandler: requireAuth }, async (request) => {
  const body = z.object({ token: z.string(), ingestingHost: z.string() }).parse(request.body);
  await store.update((db) => {
    db.settings = db.settings ?? { timezone: "America/Sao_Paulo" };
    db.settings.betterstack = { token: body.token, ingestingHost: body.ingestingHost };
  });
  return { ok: true };
});

app.post("/api/v1/integrations/betterstack/test", { preHandler: requireAuth }, async (request) => {
  const db = await store.read();
  const bs = db.settings?.betterstack;
  if (!bs?.token || !bs?.ingestingHost) throw new Error("BetterStack nao configurado");
  const url = `https://${bs.ingestingHost}`;
  const payload = JSON.stringify({ dt: new Date().toISOString(), message: "Hello from SnapVault! Integracao BetterStack funcionando." });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${bs.token}` },
    body: payload
  });
  if (!res.ok) throw new Error(`BetterStack retornou ${res.status}`);
  return { ok: true };
});

app.get("/api/v1/integrations/microsoft", { preHandler: requireAuth }, async () => {
  const db = await store.read();
  return { integrations: (db.microsoftIntegrations ?? []).map(publicMicrosoftIntegrationSafe) };
});

app.post("/api/v1/integrations/microsoft", { preHandler: requireAuth }, async (request) => {
  const body = microsoftConfigSchema.parse(request.body);
  if (!body.clientSecret) throw new Error("Client secret is required");
  const integration = await store.update((db) => {
    db.microsoftIntegrations = db.microsoftIntegrations ?? [];
    const stamp = now();
    const next = {
      id: id("ms"),
      name: body.name,
      tenantId: body.tenantId,
      clientId: body.clientId,
      encryptedClientSecret: encryptText(body.clientSecret!, config.cookieSecret),
      status: "untested" as const,
      lastTestedAt: null,
      createdAt: stamp,
      updatedAt: stamp
    };
    db.microsoftIntegrations.push(next);
    db.settings = db.settings ?? {};
    db.settings.microsoft = db.settings.microsoft ?? next;
    return publicMicrosoftIntegrationSafe(next);
  });
  return { integration };
});

app.patch("/api/v1/integrations/microsoft/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = microsoftConfigSchema.partial().parse(request.body);
  const integration = await store.update((db) => {
    const target = (db.microsoftIntegrations ?? []).find((item) => item.id === params.id);
    if (!target) throw new Error("Microsoft integration not found");
    if (body.name) target.name = body.name;
    if (body.tenantId) target.tenantId = body.tenantId;
    if (body.clientId) target.clientId = body.clientId;
    if (body.clientSecret) target.encryptedClientSecret = encryptText(body.clientSecret, config.cookieSecret);
    target.status = "untested";
    target.updatedAt = now();
    return publicMicrosoftIntegrationSafe(target);
  });
  return { integration };
});

app.post("/api/v1/integrations/microsoft/:id/test", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const credentials = await microsoftCredentials(params.id);
  const result = await microsoftCredentialStatus(credentials);
  const integration = await store.update((db) => {
    const target = (db.microsoftIntegrations ?? []).find((item) => item.id === params.id);
    if (!target) throw new Error("Microsoft integration not found");
    target.status = "healthy";
    target.lastTestedAt = now();
    target.updatedAt = now();
    return publicMicrosoftIntegrationSafe(target);
  });
  return { ...result, integration };
});

app.delete("/api/v1/integrations/microsoft/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  await store.update((db) => {
    if (db.destinations.some((item) => item.config?.microsoftIntegrationId === params.id)) throw new Error("Microsoft integration is used by storage");
    db.microsoftIntegrations = (db.microsoftIntegrations ?? []).filter((item) => item.id !== params.id);
    if (db.settings?.microsoft?.id === params.id) db.settings.microsoft = db.microsoftIntegrations[0] ?? null;
  });
  return { ok: true };
});

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
    const next = {
      id: previous?.id ?? id("ms"),
      name: body.name ?? previous?.name ?? "Microsoft principal",
      tenantId: body.tenantId,
      clientId: body.clientId,
      encryptedClientSecret: encryptText(clientSecret, config.cookieSecret),
      status: "untested",
      lastTestedAt: previous?.lastTestedAt ?? null,
      createdAt: previous?.createdAt ?? stamp,
      updatedAt: stamp
    };
    db.microsoftIntegrations = db.microsoftIntegrations ?? [];
    const index = db.microsoftIntegrations.findIndex((item) => item.id === next.id);
    if (index >= 0) db.microsoftIntegrations[index] = next as any;
    else db.microsoftIntegrations.push(next as any);
    db.settings.microsoft = next as any;
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
app.get("/api/v1/integrations/microsoft/users", { preHandler: requireAuth }, async (request) => {
  const query = z.object({ integrationId: z.string().optional() }).parse(request.query);
  return listMicrosoftUsers(await microsoftCredentials(query.integrationId));
});
app.get("/api/v1/integrations/microsoft/sites", { preHandler: requireAuth }, async (request) => {
  const query = z.object({ integrationId: z.string().optional() }).parse(request.query);
  return listMicrosoftSites(await microsoftCredentials(query.integrationId));
});
app.get("/api/v1/integrations/microsoft/site-drives", { preHandler: requireAuth }, async (request) => {
  const query = z.object({ siteId: z.string(), integrationId: z.string().optional() }).parse(request.query);
  return listMicrosoftSiteDrives(query.siteId, await microsoftCredentials(query.integrationId));
});
app.get("/api/v1/integrations/microsoft/drive-quota", { preHandler: requireAuth }, async (request) => {
  const query = z.object({ driveId: z.string(), integrationId: z.string().optional() }).parse(request.query);
  return getMicrosoftDriveQuota(query.driveId, await microsoftCredentials(query.integrationId));
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
  const db = await store.read();
  const source = db.sources.find((item) => item.id === params.id);
  if (!source) throw new Error("Source not found");
  const result = source.type === "postgres" ? await testPostgresSource(source as any) : await testMinioSource(source as any);
  await markResource("source", params.id, result);
  return result;
});

app.get("/api/v1/sources/:id/resources", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const db = await store.read();
  const source = db.sources.find((item) => item.id === params.id);
  if (!source) throw new Error("Source not found");
  if (source.type === "postgres") return testPostgresSource(source as any);
  return testMinioSource(source as any);
});

app.patch("/api/v1/sources/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = sourcePatchSchema.parse(request.body);
  const source = await store.update((db) => {
    const target = db.sources.find((item) => item.id === params.id);
    if (!target) throw new Error("Source not found");
    Object.assign(target, body, { updatedAt: now() });
    if (body.secrets) target.status = "untested";
    return withoutSecrets(target);
  });
  return { source };
});

app.delete("/api/v1/sources/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  await store.update((db) => {
    if (db.policies.some((item) => item.sourceId === params.id)) throw new Error("Source is used by a backup routine");
    if (db.runs.some((item) => item.sourceId === params.id) || db.artifacts.some((item) => item.sourceId === params.id)) throw new Error("Source has backup history; archive it instead");
    db.sources = db.sources.filter((item) => item.id !== params.id);
  });
  return { ok: true };
});

app.post("/api/v1/sources/:id/archive", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const source = await store.update((db) => {
    const target = db.sources.find((item) => item.id === params.id);
    if (!target) throw new Error("Source not found");
    target.status = "archived";
    target.updatedAt = now();
    for (const policy of db.policies.filter((item) => item.sourceId === params.id)) {
      policy.enabled = false;
      policy.updatedAt = now();
    }
    return withoutSecrets(target);
  });
  return { source };
});

app.post("/api/v1/sources/:id/reactivate", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const source = await store.update((db) => {
    const target = db.sources.find((item) => item.id === params.id);
    if (!target) throw new Error("Source not found");
    target.status = "untested";
    target.updatedAt = now();
    return withoutSecrets(target);
  });
  return { source };
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
    const result = await testMicrosoftDestination(destination.config as any, destination.basePath, await microsoftCredentials(String(destination.config.microsoftIntegrationId ?? "")));
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
    const source = db.sources.find((item) => item.id === body.sourceId);
    if (!source) throw new Error("Source not found");
    if (source.status !== "healthy") throw new Error("Source must be tested and healthy before creating a backup routine");
    const destination = db.destinations.find((item) => item.id === body.destinationId);
    if (!destination) throw new Error("Destination not found");
    if (destination.status !== "healthy") throw new Error("Destination must be tested and healthy before creating a backup routine");
    assertDestinationReady(destination);
    validatePolicyScope(source, body.sourceScope);
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
    if (body.sourceId) {
      const source = db.sources.find((item) => item.id === body.sourceId);
      if (!source || source.status !== "healthy") throw new Error("Source must be healthy");
    }
    if (body.destinationId) {
      const destination = db.destinations.find((item) => item.id === body.destinationId);
      if (!destination || destination.status !== "healthy") throw new Error("Destination must be healthy");
      assertDestinationReady(destination);
    }
    const source = db.sources.find((item) => item.id === (body.sourceId ?? target.sourceId));
    if (source && body.sourceScope) validatePolicyScope(source, body.sourceScope);
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
    const source = db.sources.find((item) => item.id === policy.sourceId);
    if (!source) throw new Error("Source not found");
    if (source.status !== "healthy") throw new Error("Source must be healthy before running a backup");
    const destination = db.destinations.find((item) => item.id === policy.destinationId);
    if (!destination) throw new Error("Destination not found");
    if (destination.status !== "healthy") throw new Error("Destination must be healthy before running a backup");
    assertDestinationReady(destination);
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

app.get("/api/v1/runs/:id", { preHandler: requireAuth }, async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const db = await store.read();
  const LOG_LIMIT = 500;
  const allLogs = db.logs.filter((item) => item.runId === params.id);
  const truncated = allLogs.length > LOG_LIMIT;
  if (truncated) reply.header("X-Log-Truncated", String(allLogs.length));
  return {
    run: db.runs.find((item) => item.id === params.id),
    logs: truncated ? allLogs.slice(-LOG_LIMIT) : allLogs,
    artifacts: db.artifacts.filter((item) => item.runId === params.id)
  };
});

app.get("/api/v1/artifacts/:id/download", { preHandler: requireAuth }, async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const db = await store.read();
  const artifact = db.artifacts.find((item) => item.id === params.id);
  if (!artifact) { reply.status(404); return { error: "Artifact not found" }; }
  const filename = artifact.path.split(/[\\/]/).pop() ?? "artifact";
  reply.header("Content-Disposition", `attachment; filename="${filename}"`);
  if (artifact.sizeBytes) reply.header("Content-Length", String(artifact.sizeBytes));
  reply.header("Content-Type", "application/octet-stream");
  if (artifact.path.startsWith("/")) {
    await stat(artifact.path);
    return reply.send(createReadStream(artifact.path));
  }
  const destination = db.destinations.find((item) => item.id === artifact.destinationId);
  if (!destination) { reply.status(404); return { error: "Destination not found" }; }
  if ((destination.type === "onedrive" || destination.type === "sharepoint") && destination.config.mode === "graph") {
    const { downloadMicrosoftDrivePath } = await import("./microsoftGraph.js");
    const tmpDir = join(config.stagingDir, "downloads", params.id);
    await mkdir(tmpDir, { recursive: true });
    try {
      const localFile = join(tmpDir, filename);
      await downloadMicrosoftDrivePath(destination.config as any, artifact.path, localFile, await microsoftCredentials(String(destination.config.microsoftIntegrationId ?? "")));
      const stream = createReadStream(localFile);
      stream.on("close", () => rm(tmpDir, { recursive: true, force: true }));
      return reply.send(stream);
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true });
      throw err;
    }
  }
  if (destination.config?.rcloneRemoteName) {
    const { spawn } = await import("node:child_process");
    const remote = `${destination.config.rcloneRemoteName}:${artifact.path}`;
    const proc = spawn("rclone", ["cat", remote]);
    proc.stderr.on("data", (chunk: Buffer) => request.log.warn("rclone cat stderr: " + chunk.toString()));
    return reply.send(proc.stdout);
  }
  reply.status(422);
  return { error: "Artifact is stored on a remote destination that does not support direct download" };
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

app.post("/api/v1/restores/execute", { preHandler: requireAuth }, async (request) => {
  const body = z.object({
    artifactId: z.string(),
    targetSourceId: z.string(),
    targetScope: z.object({
      mode: z.enum(["single"]),
      database: z.string().optional(),
      bucket: z.string().optional(),
      prefix: z.string().optional()
    }).optional()
  }).parse(request.body);
  const db = await store.read();
  const artifact = db.artifacts.find((item) => item.id === body.artifactId);
  const target = db.sources.find((item) => item.id === body.targetSourceId);
  if (!artifact) throw new Error("Artifact not found");
  if (!target) throw new Error("Target source not found");
  if (target.status !== "healthy") throw new Error("Target source must be healthy");
  const run = db.runs.find((item) => item.id === artifact.runId);
  const destination = run ? db.destinations.find((item) => item.id === run.destinationId) : null;
  if (!destination) throw new Error("Artifact destination not found");
  const restoreDir = join(config.stagingDir, "manual-restores", id("rst"));
  await mkdir(restoreDir, { recursive: true });
  try {
    const localFile = join(restoreDir, basename(artifact.path));
    if ((destination.type === "sharepoint" || destination.type === "onedrive") && destination.config.mode === "graph") {
      const { downloadMicrosoftDrivePath } = await import("./microsoftGraph.js");
      await downloadMicrosoftDrivePath(destination.config as any, artifact.path, localFile, await microsoftCredentials(String(destination.config.microsoftIntegrationId ?? "")));
    } else if (artifact.path.startsWith("/")) {
      await runCommand("cp", [artifact.path, localFile]);
    } else {
      throw new Error("Restore execution requires Microsoft Graph or local artifact");
    }
    const result = target.type === "postgres" ? await restorePostgresArtifact(target as any, localFile, body.targetScope) : await restoreMinioArtifact(target as any, localFile, restoreDir, body.targetScope);
    return { restoreId: id("rst"), status: "completed", targetSourceId: target.id, result };
  } finally {
    await rm(restoreDir, { recursive: true, force: true });
  }
});

function validatePolicyScope(source: any, scope: any) {
  const resolved = resolveSourceScope(source, scope);
  if (source.type === "postgres" && resolved.mode !== "all" && !resolved.database) throw new Error("Choose a database for this PostgreSQL backup routine");
  if (source.type === "minio" && resolved.mode !== "all" && !resolved.bucket) throw new Error("Choose a bucket for this MinIO backup routine");
}

function resolveSourceScope(source: any, scope?: any) {
  const sourceConfig = source.config as any;
  if (scope?.mode) return scope;
  if (source.type === "postgres") return { mode: sourceConfig.scope === "all" ? "all" : "single", database: sourceConfig.database };
  return { mode: sourceConfig.scope === "all" ? "all" : "single", bucket: sourceConfig.bucket, prefix: sourceConfig.prefix ?? "" };
}

function assertDestinationReady(destination: any) {
  if ((destination.type === "onedrive" || destination.type === "sharepoint") && destination.config?.mode === "graph") {
    const hasDriveTarget = Boolean(destination.config.driveId || destination.config.userPrincipalName || destination.config.siteId || (destination.config.hostname && destination.config.sitePath));
    if (!hasDriveTarget) throw new Error("Microsoft storage is incomplete. Edit Storage, choose site/library or OneDrive user, then test again.");
    if (!destination.config.microsoftIntegrationId) throw new Error("Microsoft storage has no integration selected. Edit Storage and choose an integration.");
  }
}

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

function publicMicrosoftIntegrationSafe(integration: any) {
  return {
    configured: true,
    id: integration.id,
    name: integration.name,
    tenantId: integration.tenantId,
    clientId: integration.clientId,
    clientSecretSet: Boolean(integration.encryptedClientSecret),
    status: integration.status,
    lastTestedAt: integration.lastTestedAt,
    updatedAt: integration.updatedAt
  };
}

async function testPostgresSource(source: any) {
  const sourceConfig = source.config as any;
  const env = { PGPASSWORD: source.secrets?.password ?? "" };
  const connectDb = String(sourceConfig.database || "template1");
  const args = ["-h", String(sourceConfig.host), "-p", String(sourceConfig.port ?? 5432), "-U", String(sourceConfig.username), "-d", connectDb, "-tAc", "select datname from pg_database where datallowconn and not datistemplate order by datname"];
  const result = await runCommand("psql", args, env);
  if (result.code !== 0) throw new Error(result.stderr || "PostgreSQL connection failed");
  const databases = result.stdout.split("\n").map((item) => item.trim()).filter(Boolean);
  if (!databases.length) throw new Error("No accessible PostgreSQL databases found");
  return { status: "healthy", kind: "postgres", resources: { databases }, selected: databases[0] };
}

async function testMinioSource(source: any) {
  const sourceConfig = source.config as any;
  const alias = `snapvault-test-${source.id}-${Date.now()}`;
  const aliasResult = await runCommand("mc", ["alias", "set", alias, String(sourceConfig.endpoint), source.secrets?.accessKey ?? "", source.secrets?.secretKey ?? ""]);
  if (aliasResult.code !== 0) throw new Error(aliasResult.stderr || "MinIO connection failed");
  try {
    const list = await runCommand("mc", ["ls", "--json", alias]);
    if (list.code !== 0) throw new Error(list.stderr || "MinIO bucket listing failed");
    const buckets = list.stdout.split("\n").map((line) => {
      try { return JSON.parse(line).key?.replace(/\/$/, ""); } catch { return ""; }
    }).filter(Boolean);
    if (!buckets.length) throw new Error("No accessible MinIO buckets found");
    return { status: "healthy", kind: "minio", resources: { buckets }, selected: buckets[0] };
  } finally {
    await runCommand("mc", ["alias", "remove", alias]);
  }
}

async function restorePostgresArtifact(source: any, localFile: string, scope?: any) {
  const sourceConfig = source.config as any;
  const database = String(scope?.database ?? sourceConfig.database ?? "");
  if (!database) throw new Error("Manual PostgreSQL restore requires a target database");
  const env = { PGPASSWORD: source.secrets?.password ?? "" };
  const restore = await runCommand("sh", ["-lc", `gzip -cd "$1" | psql -h "$2" -p "$3" -U "$4" -d "$5"`, "sh", localFile, String(sourceConfig.host), String(sourceConfig.port ?? 5432), String(sourceConfig.username), database], env);
  if (restore.code !== 0) throw new Error(restore.stderr || "PostgreSQL restore failed");
  return { type: "postgres", database };
}

async function restoreMinioArtifact(source: any, localFile: string, restoreDir: string, scope?: any) {
  const sourceConfig = source.config as any;
  const bucket = String(scope?.bucket ?? sourceConfig.bucket ?? "");
  const prefix = String(scope?.prefix ?? sourceConfig.prefix ?? "");
  if (!bucket) throw new Error("Manual MinIO restore requires a target bucket");
  const extractDir = join(restoreDir, "objects");
  await mkdir(extractDir, { recursive: true });
  const tar = await runCommand("tar", ["-xzf", localFile, "-C", extractDir]);
  if (tar.code !== 0) throw new Error(tar.stderr || "MinIO artifact extraction failed");
  const alias = `snapvault-restore-${source.id}-${Date.now()}`;
  const aliasResult = await runCommand("mc", ["alias", "set", alias, String(sourceConfig.endpoint), source.secrets?.accessKey ?? "", source.secrets?.secretKey ?? ""]);
  if (aliasResult.code !== 0) throw new Error(aliasResult.stderr || "MinIO connection failed");
  try {
    const target = [bucket, prefix.replace(/^\/+|\/+$/g, "")].filter(Boolean).join("/");
    const copy = await runCommand("mc", ["cp", "--recursive", extractDir, `${alias}/${target}`]);
    if (copy.code !== 0) throw new Error(copy.stderr || "MinIO restore copy failed");
    return { type: "minio", bucket, prefix };
  } finally {
    await runCommand("mc", ["alias", "remove", alias]);
  }
}

async function microsoftCredentials(integrationId?: string) {
  const db = await store.read();
  const saved = integrationId
    ? (db.microsoftIntegrations ?? []).find((item) => item.id === integrationId) ?? db.settings?.microsoft
    : db.settings?.microsoft ?? (db.microsoftIntegrations ?? [])[0];
  if (saved?.tenantId && saved?.clientId && saved?.encryptedClientSecret) {
    return { tenantId: saved.tenantId, clientId: saved.clientId, clientSecret: decryptText(saved.encryptedClientSecret, config.cookieSecret) };
  }
  if (config.microsoft.tenantId && config.microsoft.clientId && config.microsoft.clientSecret) return config.microsoft;
  throw new Error("Microsoft credentials are not configured");
}

function timeInZone(date: Date, timezone: string): { hhmm: string; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit", minute: "2-digit", weekday: "short",
    hour12: false
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hh = get("hour").padStart(2, "0");
  const mm = get("minute").padStart(2, "0");
  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekday = weekdayNames.indexOf(get("weekday"));
  return { hhmm: `${hh}:${mm}`, weekday };
}

function startScheduler() {
  setInterval(async () => {
    try {
      const db = await store.read();
      const systemTimezone = db.settings?.timezone ?? "America/Sao_Paulo";
      const current = new Date();
      for (const policy of db.policies) {
        if (!policy.enabled || policy.schedule.type === "manual" || policy.schedule.type === "cron") continue;
        const tz = policy.schedule.timezone || systemTimezone;
        const { hhmm, weekday } = timeInZone(current, tz);
        const wantedTime = policy.schedule.time ?? "02:00";
        if (wantedTime !== hhmm) continue;
        if (policy.schedule.type === "weekly" && Number(policy.schedule.weekday ?? 0) !== weekday) continue;
        const key = `${policy.id}:${hhmm}:${current.toISOString().slice(0, 10)}`;
        if (scheduledKeys.has(key)) continue;
        scheduledKeys.add(key);
        const source = db.sources.find((item) => item.id === policy.sourceId);
        const destination = db.destinations.find((item) => item.id === policy.destinationId);
        if (source?.status !== "healthy" || destination?.status !== "healthy") continue;
        try {
          assertDestinationReady(destination);
        } catch (error) {
          app.log.warn({ policyId: policy.id, error }, "Scheduled backup skipped because destination is incomplete");
          continue;
        }
        const run = await store.update((next) => {
          const created: any = { id: id("run"), policyId: policy.id, sourceId: policy.sourceId, destinationId: policy.destinationId, trigger: "scheduled", status: "queued", startedAt: null, finishedAt: null, durationMs: null, bytesWritten: null, errorCode: null, errorMessage: null, verificationStatus: "not_checked", verifiedAt: null, createdAt: now() };
          next.runs.push(created);
          return created;
        });
        void executeBackupRun(store, run.id, config.stagingDir);
      }
      if (scheduledKeys.size > 5000) scheduledKeys.clear();
    } catch (error) {
      app.log.error(error);
    }
  }, 60_000);
}

async function gracefulShutdown(reason: string) {
  app.log.warn({ reason }, "graceful shutdown iniciado");
  const timeout = setTimeout(() => {
    app.log.error("graceful shutdown timeout — forcando saida");
    process.exit(1);
  }, 5000);
  try {
    await app.close();
    clearTimeout(timeout);
    app.log.warn("servidor encerrado com sucesso");
    process.exit(0);
  } catch (err) {
    clearTimeout(timeout);
    app.log.error({ err }, "erro durante graceful shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM recebido"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT recebido"));

process.on("uncaughtException", (err) => {
  app.log.fatal({ err }, "uncaughtException — processo vai encerrar");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  app.log.fatal({ reason }, "unhandledRejection — processo vai encerrar");
  process.exit(1);
});

// Ao iniciar, marcar como failed qualquer run preso em queued/running
// (causado por crash do processo enquanto o backup estava em andamento)
const stuckCount = await store.update((db) => {
  const stuck = db.runs.filter((r) => r.status === "queued" || r.status === "running");
  for (const run of stuck) {
    run.status = "failed";
    run.finishedAt = now();
    run.errorCode = "PROCESS_CRASH";
    run.errorMessage = "Execucao interrompida por reinicio inesperado do processo";
  }
  return stuck.length;
});
if (stuckCount > 0) {
  app.log.warn({ stuckCount }, `boot: ${stuckCount} run(s) preso(s) marcado(s) como failed`);
}

await app.listen({ host: config.host, port: config.port });

// Notifica o master que este worker está pronto para receber tráfego
if (process.send) {
  process.send({ type: "ready" });
  app.log.info("[worker] sinal 'ready' enviado ao master");
}

// Escuta comando de shutdown vindo do master (rolling restart)
process.on("message", (msg: any) => {
  if (msg?.type === "shutdown") {
    gracefulShutdown("shutdown solicitado pelo master (rolling restart)");
  }
});

startScheduler();
