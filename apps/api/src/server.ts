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
import { createDb } from "./db.js";
import { decryptText, encryptText } from "./crypto.js";
import { id, now } from "./ids.js";
import { publicUser, withoutSecrets } from "./store.js";
import { executeBackupRun } from "./backup.js";
import { getMicrosoftDriveQuota, listMicrosoftSiteDrives, listMicrosoftSites, listMicrosoftUsers, microsoftCredentialStatus, testMicrosoftDestination } from "./microsoftGraph.js";
import { verifyRestoreForRun } from "./restoreVerify.js";
import { runCommand } from "./runner.js";

const db = await createDb(config.pg);

// Token: env var tem prioridade; fallback para o valor salvo no banco
const initSettings = await db.getSettings();
const betterstackToken = config.betterstackToken || initSettings.betterstack?.token || "";
const betterstackHost = initSettings.betterstack?.ingestingHost || "";

const loggerOptions = betterstackToken
  ? {
      level: "info",
      transport: {
        targets: [
          { target: "pino/file", options: { destination: 1 }, level: "info" },
          {
            target: "@logtail/pino",
            options: {
              sourceToken: betterstackToken,
              ...(betterstackHost ? { options: { endpoint: `https://${betterstackHost}` } } : {})
            },
            level: "info"
          }
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

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "operator", "viewer"]).default("viewer")
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(["admin", "operator", "viewer"]).optional()
});

const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8)
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const message = error instanceof Error ? error.message : "Request failed";
  reply.status(400).send({ error: { code: "REQUEST_FAILED", message, details: {} } });
});

app.get("/health", async () => ({ status: "ok" }));
app.get("/ready", async () => ({ status: "ready" }));

app.get("/api/v1/setup/status", async () => {
  const count = await db.countUsers();
  return { requiresSetup: count === 0 };
});

app.post("/api/v1/setup/admin", async (request, reply) => {
  const body = z.object({ name: z.string().min(1), email: z.string().email(), password: z.string().min(8) }).parse(request.body);
  const count = await db.countUsers();
  if (count > 0) throw new Error("Setup already completed");
  const user = await db.createUser({
    id: id("user"),
    name: body.name,
    email: body.email.toLowerCase(),
    passwordHash: await bcrypt.hash(body.password, 12),
    role: "admin"
  });
  await createSession(reply, user.id);
  return { user: publicUser(user) };
});

app.post("/api/v1/auth/login", async (request, reply) => {
  const body = z.object({ email: z.string().email(), password: z.string() }).parse(request.body);
  const user = await db.getUserByEmail(body.email.toLowerCase());
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
    return reply.status(401).send({ error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password", details: {} } });
  }
  await createSession(reply, user.id);
  return { user: publicUser(user) };
});

app.post("/api/v1/auth/logout", async (request, reply) => {
  const sessionId = request.cookies.snapvault_session;
  if (sessionId) await db.deleteSession(sessionId);
  reply.clearCookie("snapvault_session", { path: "/" });
  return { ok: true };
});

app.get("/api/v1/auth/me", { preHandler: requireAuth }, async (request) => ({ user: publicUser((request as any).user) }));

app.post("/api/v1/admin/restart", { preHandler: requireAuth }, async (_request, reply) => {
  reply.send({ ok: true, message: "Reinicio solicitado..." });
  setImmediate(() => {
    if (process.send) {
      process.send({ type: "restart" });
    } else {
      gracefulShutdown("restart solicitado pelo usuario via painel");
    }
  });
});

app.get("/api/v1/settings", { preHandler: requireAuth }, async () => {
  const settings = await db.getSettings();
  return { timezone: settings.timezone ?? "America/Sao_Paulo" };
});

app.patch("/api/v1/settings", { preHandler: requireAuth }, async (request) => {
  const body = z.object({ timezone: z.string().min(1) }).parse(request.body);
  await db.setSetting("timezone", body.timezone);
  return { timezone: body.timezone };
});

app.get("/api/v1/integrations/betterstack", { preHandler: requireAuth }, async () => {
  const settings = await db.getSettings();
  const bs = settings.betterstack;
  return { configured: Boolean(bs?.token), ingestingHost: bs?.ingestingHost ?? "", tokenSet: Boolean(bs?.token) };
});

app.patch("/api/v1/integrations/betterstack", { preHandler: requireAuth }, async (request) => {
  const body = z.object({ token: z.string(), ingestingHost: z.string() }).parse(request.body);
  await db.setSetting("betterstack", { token: body.token, ingestingHost: body.ingestingHost });
  return { ok: true };
});

app.post("/api/v1/integrations/betterstack/test", { preHandler: requireAuth }, async () => {
  const settings = await db.getSettings();
  const bs = settings.betterstack;
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
  const integrations = await db.listMicrosoftIntegrations();
  return { integrations: integrations.map(publicMicrosoftIntegrationSafe) };
});

app.post("/api/v1/integrations/microsoft", { preHandler: requireAuth }, async (request) => {
  const body = microsoftConfigSchema.parse(request.body);
  if (!body.clientSecret) throw new Error("Client secret is required");
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
  const integration = await db.upsertMicrosoftIntegration(next);
  // Set as default if first
  const all = await db.listMicrosoftIntegrations();
  if (all.length === 1) await db.setSetting("microsoft", integration);
  return { integration: publicMicrosoftIntegrationSafe(integration) };
});

app.patch("/api/v1/integrations/microsoft/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = microsoftConfigSchema.partial().parse(request.body);
  const target = await db.getMicrosoftIntegration(params.id);
  if (!target) throw new Error("Microsoft integration not found");
  const updated = {
    ...target,
    name: body.name ?? target.name,
    tenantId: body.tenantId ?? target.tenantId,
    clientId: body.clientId ?? target.clientId,
    encryptedClientSecret: body.clientSecret ? encryptText(body.clientSecret, config.cookieSecret) : target.encryptedClientSecret,
    status: "untested" as const,
    updatedAt: now()
  };
  const integration = await db.upsertMicrosoftIntegration(updated);
  return { integration: publicMicrosoftIntegrationSafe(integration) };
});

app.post("/api/v1/integrations/microsoft/:id/test", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const credentials = await microsoftCredentials(params.id);
  const result = await microsoftCredentialStatus(credentials);
  const target = await db.getMicrosoftIntegration(params.id);
  if (!target) throw new Error("Microsoft integration not found");
  const updated = { ...target, status: "healthy" as const, lastTestedAt: now(), updatedAt: now() };
  const integration = await db.upsertMicrosoftIntegration(updated);
  return { ...result, integration: publicMicrosoftIntegrationSafe(integration) };
});

app.delete("/api/v1/integrations/microsoft/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const destinations = await db.listDestinations();
  if (destinations.some((item) => item.config?.microsoftIntegrationId === params.id)) throw new Error("Microsoft integration is used by storage");
  await db.deleteMicrosoftIntegration(params.id);
  // Update default if needed
  const settings = await db.getSettings();
  if ((settings.microsoft as any)?.id === params.id) {
    const remaining = await db.listMicrosoftIntegrations();
    await db.setSetting("microsoft", remaining[0] ?? null);
  }
  return { ok: true };
});

app.get("/api/v1/integrations/microsoft/config", { preHandler: requireAuth }, async () => {
  const settings = await db.getSettings();
  const integrations = await db.listMicrosoftIntegrations();
  const saved = settings.microsoft ?? integrations[0] ?? null;
  if (saved) return publicMicrosoftIntegrationSafe(saved);
  return {
    configured: Boolean(config.microsoft.tenantId && config.microsoft.clientId && config.microsoft.clientSecret),
    id: "", name: "",
    tenantId: config.microsoft.tenantId,
    clientId: config.microsoft.clientId,
    clientSecretSet: Boolean(config.microsoft.clientSecret),
    status: "untested",
    lastTestedAt: null,
    source: config.microsoft.clientSecret ? "env" : "none"
  };
});

app.put("/api/v1/integrations/microsoft/config", { preHandler: requireAuth }, async (request) => {
  const body = microsoftConfigSchema.parse(request.body);
  const settings = await db.getSettings();
  const previous = settings.microsoft;
  const clientSecret = body.clientSecret
    ? body.clientSecret
    : previous?.encryptedClientSecret
      ? decryptText(previous.encryptedClientSecret, config.cookieSecret)
      : config.microsoft.clientSecret;
  if (!clientSecret) throw new Error("Client secret is required");
  const stamp = now();
  const next = {
    id: previous?.id ?? id("ms"),
    name: body.name ?? previous?.name ?? "Microsoft principal",
    tenantId: body.tenantId,
    clientId: body.clientId,
    encryptedClientSecret: encryptText(clientSecret, config.cookieSecret),
    status: "untested" as const,
    lastTestedAt: previous?.lastTestedAt ?? null,
    createdAt: previous?.createdAt ?? stamp,
    updatedAt: stamp
  };
  const integration = await db.upsertMicrosoftIntegration(next);
  await db.setSetting("microsoft", integration);
  return publicMicrosoftIntegrationSafe(integration);
});

app.post("/api/v1/integrations/microsoft/test", { preHandler: requireAuth }, async () => {
  const credentials = await microsoftCredentials();
  const result = await microsoftCredentialStatus(credentials);
  const settings = await db.getSettings();
  if (settings.microsoft) {
    const updated = { ...settings.microsoft, status: "healthy" as const, lastTestedAt: now(), updatedAt: now() };
    await db.upsertMicrosoftIntegration(updated);
    await db.setSetting("microsoft", updated);
  }
  return { ...result };
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

// ── Users management ──────────────────────────────────────────────────────────

app.get("/api/v1/users", { preHandler: requireAuth }, async (request) => {
  const reqUser = (request as any).user;
  if (reqUser.role !== "admin") return { users: [publicUser(reqUser)] };
  const users = await db.listUsers();
  return { users: users.map(publicUser) };
});

app.post("/api/v1/users", { preHandler: requireAuth }, async (request) => {
  const reqUser = (request as any).user;
  if (reqUser.role !== "admin") throw new Error("Admin required");
  const body = createUserSchema.parse(request.body);
  const existing = await db.getUserByEmail(body.email.toLowerCase());
  if (existing) throw new Error("Email already in use");
  const user = await db.createUser({
    id: id("user"),
    name: body.name,
    email: body.email.toLowerCase(),
    passwordHash: await bcrypt.hash(body.password, 12),
    role: body.role
  });
  return { user: publicUser(user) };
});

app.patch("/api/v1/users/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const reqUser = (request as any).user;
  const isAdmin = reqUser.role === "admin";
  const isSelf = reqUser.id === params.id;
  if (!isAdmin && !isSelf) throw new Error("Forbidden");
  const body = updateUserSchema.parse(request.body);
  const updateData: any = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.email !== undefined && isAdmin) updateData.email = body.email.toLowerCase();
  if (body.role !== undefined && isAdmin) updateData.role = body.role;
  const user = await db.updateUser(params.id, updateData);
  return { user: publicUser(user) };
});

app.delete("/api/v1/users/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const reqUser = (request as any).user;
  if (reqUser.role !== "admin") throw new Error("Admin required");
  if (reqUser.id === params.id) throw new Error("Cannot delete your own account");
  // Prevent removing last admin
  const target = await db.getUser(params.id);
  if (target?.role === "admin") {
    const allUsers = await db.listUsers();
    const adminCount = allUsers.filter((u) => u.role === "admin").length;
    if (adminCount <= 1) throw new Error("Cannot remove the last admin");
  }
  await db.deleteUser(params.id);
  return { ok: true };
});

app.post("/api/v1/users/:id/password", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const reqUser = (request as any).user;
  const isAdmin = reqUser.role === "admin";
  const isSelf = reqUser.id === params.id;
  if (!isAdmin && !isSelf) throw new Error("Forbidden");
  const body = changePasswordSchema.parse(request.body);
  if (!isAdmin) {
    if (!body.currentPassword) throw new Error("Current password is required");
    const user = await db.getUser(params.id);
    if (!user || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) throw new Error("Current password is incorrect");
  }
  const passwordHash = await bcrypt.hash(body.newPassword, 12);
  await db.updateUser(params.id, { passwordHash });
  return { ok: true };
});

// ── Sources ───────────────────────────────────────────────────────────────────

app.get("/api/v1/sources", { preHandler: requireAuth }, async () => {
  const sources = await db.listSources();
  return { sources: sources.map(withoutSecrets) };
});

app.post("/api/v1/sources", { preHandler: requireAuth }, async (request) => {
  const body = sourceSchema.parse(request.body);
  const created = now();
  const source = await db.createSource({ id: id("src"), ...body, status: "untested", lastTestedAt: null, createdAt: created, updatedAt: created });
  return { source: withoutSecrets(source) };
});

app.post("/api/v1/sources/:id/test", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const source = await db.getSource(params.id);
  if (!source) throw new Error("Source not found");
  const result = source.type === "postgres" ? await testPostgresSource(source as any) : await testMinioSource(source as any);
  await markResource("source", params.id, result);
  return result;
});

app.get("/api/v1/sources/:id/resources", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const source = await db.getSource(params.id);
  if (!source) throw new Error("Source not found");
  if (source.type === "postgres") return testPostgresSource(source as any);
  return testMinioSource(source as any);
});

app.patch("/api/v1/sources/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = sourcePatchSchema.parse(request.body);
  const current = await db.getSource(params.id);
  if (!current) throw new Error("Source not found");
  const updateData: any = { ...body, updatedAt: now() };
  if (body.secrets) updateData.status = "untested";
  const source = await db.updateSource(params.id, updateData);
  return { source: withoutSecrets(source) };
});

app.delete("/api/v1/sources/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const policies = await db.listPolicies();
  if (policies.some((item) => item.sourceId === params.id)) throw new Error("Source is used by a backup routine");
  const runs = await db.listRuns();
  const artifacts = await db.listArtifacts();
  if (runs.some((item) => item.sourceId === params.id) || artifacts.some((item) => item.sourceId === params.id)) throw new Error("Source has backup history; archive it instead");
  await db.deleteSource(params.id);
  return { ok: true };
});

app.post("/api/v1/sources/:id/archive", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const source = await db.updateSource(params.id, { status: "archived", updatedAt: now() });
  const policies = await db.listPolicies();
  for (const policy of policies.filter((item) => item.sourceId === params.id)) {
    await db.updatePolicy(policy.id, { enabled: false, updatedAt: now() });
  }
  return { source: withoutSecrets(source) };
});

app.post("/api/v1/sources/:id/reactivate", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const source = await db.updateSource(params.id, { status: "untested", updatedAt: now() });
  return { source: withoutSecrets(source) };
});

// ── Destinations ──────────────────────────────────────────────────────────────

app.get("/api/v1/destinations", { preHandler: requireAuth }, async () => {
  const destinations = await db.listDestinations();
  return { destinations: destinations.map(withoutSecrets) };
});

app.post("/api/v1/destinations", { preHandler: requireAuth }, async (request) => {
  const body = destinationSchema.parse(request.body);
  const created = now();
  const destination = await db.createDestination({ id: id("dst"), ...body, status: "untested", lastTestedAt: null, metadata: body.metadata ?? {}, archivedAt: null, createdAt: created, updatedAt: created });
  return { destination: withoutSecrets(destination) };
});

app.post("/api/v1/destinations/:id/test", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const destination = await db.getDestination(params.id);
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
  const destination = await db.updateDestination(params.id, { ...body, updatedAt: now() });
  return { destination: withoutSecrets(destination) };
});

app.delete("/api/v1/destinations/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const policies = await db.listPolicies();
  if (policies.some((item) => item.destinationId === params.id)) throw new Error("Destination is used by a backup routine");
  const runs = await db.listRuns();
  const artifacts = await db.listArtifacts();
  if (runs.some((item) => item.destinationId === params.id) || artifacts.some((item) => item.destinationId === params.id)) throw new Error("Destination has backup history; archive it instead");
  await db.deleteDestination(params.id);
  return { ok: true };
});

app.post("/api/v1/destinations/:id/archive", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const destination = await db.updateDestination(params.id, { status: "archived", archivedAt: now(), updatedAt: now() });
  const policies = await db.listPolicies();
  for (const policy of policies.filter((item) => item.destinationId === params.id)) {
    await db.updatePolicy(policy.id, { enabled: false, updatedAt: now() });
  }
  return { destination: withoutSecrets(destination) };
});

app.post("/api/v1/destinations/:id/reactivate", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const destination = await db.updateDestination(params.id, { status: "untested", archivedAt: null, updatedAt: now() });
  return { destination: withoutSecrets(destination) };
});

// ── Policies ──────────────────────────────────────────────────────────────────

app.get("/api/v1/policies", { preHandler: requireAuth }, async () => {
  const policies = await db.listPolicies();
  return { policies };
});

app.post("/api/v1/policies", { preHandler: requireAuth }, async (request) => {
  const body = policySchema.parse(request.body);
  const source = await db.getSource(body.sourceId);
  if (!source) throw new Error("Source not found");
  if (source.status !== "healthy") throw new Error("Source must be tested and healthy before creating a backup routine");
  const destination = await db.getDestination(body.destinationId);
  if (!destination) throw new Error("Destination not found");
  if (destination.status !== "healthy") throw new Error("Destination must be tested and healthy before creating a backup routine");
  assertDestinationReady(destination);
  validatePolicyScope(source, body.sourceScope);
  const created = now();
  const policy = await db.createPolicy({ id: id("pol"), ...body, createdAt: created, updatedAt: created });
  return { policy };
});

app.patch("/api/v1/policies/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = policyPatchSchema.parse(request.body);
  const target = await db.getPolicy(params.id);
  if (!target) throw new Error("Policy not found");
  if (body.sourceId) {
    const source = await db.getSource(body.sourceId);
    if (!source || source.status !== "healthy") throw new Error("Source must be healthy");
  }
  if (body.destinationId) {
    const destination = await db.getDestination(body.destinationId);
    if (!destination || destination.status !== "healthy") throw new Error("Destination must be healthy");
    assertDestinationReady(destination);
  }
  const source = await db.getSource(body.sourceId ?? target.sourceId);
  if (source && body.sourceScope) validatePolicyScope(source, body.sourceScope);
  const policy = await db.updatePolicy(params.id, { ...body, updatedAt: now() });
  return { policy };
});

app.delete("/api/v1/policies/:id", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  await db.deletePolicy(params.id);
  return { ok: true };
});

app.post("/api/v1/policies/:id/run", { preHandler: requireAuth }, async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const policy = await db.getPolicy(params.id);
  if (!policy) throw new Error("Policy not found");
  const source = await db.getSource(policy.sourceId);
  if (!source) throw new Error("Source not found");
  if (source.status !== "healthy") throw new Error("Source must be healthy before running a backup");
  const destination = await db.getDestination(policy.destinationId);
  if (!destination) throw new Error("Destination not found");
  if (destination.status !== "healthy") throw new Error("Destination must be healthy before running a backup");
  assertDestinationReady(destination);
  const run = await db.createRun({
    id: id("run"),
    policyId: policy.id,
    sourceId: policy.sourceId,
    destinationId: policy.destinationId,
    trigger: "manual",
    status: "queued",
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    bytesWritten: null,
    errorCode: null,
    errorMessage: null,
    verificationStatus: "not_checked",
    verifiedAt: null,
    createdAt: now()
  });
  void executeBackupRun(db, run.id, config.stagingDir);
  return { runId: run.id, status: run.status };
});

app.get("/api/v1/runs", { preHandler: requireAuth }, async () => {
  const runs = await db.listRuns();
  return { runs };
});

app.get("/api/v1/runs/:id", { preHandler: requireAuth }, async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const LOG_LIMIT = 500;
  const run = await db.getRun(params.id);
  const allLogs = await db.getLogs(params.id);
  const truncated = allLogs.length > LOG_LIMIT;
  if (truncated) reply.header("X-Log-Truncated", String(allLogs.length));
  const artifacts = await db.listArtifacts(params.id);
  return {
    run,
    logs: truncated ? allLogs.slice(-LOG_LIMIT) : allLogs,
    artifacts
  };
});

app.get("/api/v1/artifacts/:id/download", { preHandler: requireAuth }, async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const artifact = await db.getArtifact(params.id);
  if (!artifact) { reply.status(404); return { error: "Artifact not found" }; }
  const filename = artifact.path.split(/[\\/]/).pop() ?? "artifact";
  reply.header("Content-Disposition", `attachment; filename="${filename}"`);
  if (artifact.sizeBytes) reply.header("Content-Length", String(artifact.sizeBytes));
  reply.header("Content-Type", "application/octet-stream");
  if (artifact.path.startsWith("/")) {
    await stat(artifact.path);
    return reply.send(createReadStream(artifact.path));
  }
  const destination = await db.getDestination(artifact.destinationId);
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
  return verifyRestoreForRun(db, params.id, config.stagingDir);
});

app.post("/api/v1/restores/prepare", { preHandler: requireAuth }, async (request) => {
  const body = z.object({ artifactId: z.string() }).parse(request.body);
  const artifact = await db.getArtifact(body.artifactId);
  if (!artifact) throw new Error("Artifact not found");
  const run = await db.getRun(artifact.runId);
  const source = run ? await db.getSource(run.sourceId) : null;
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
  const artifact = await db.getArtifact(body.artifactId);
  const target = await db.getSource(body.targetSourceId);
  if (!artifact) throw new Error("Artifact not found");
  if (!target) throw new Error("Target source not found");
  if (target.status !== "healthy") throw new Error("Target source must be healthy");
  const run = await db.getRun(artifact.runId);
  const destination = run ? await db.getDestination(run.destinationId) : null;
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

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  const session = await db.createSession({ id: id("sess"), userId, expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString() });
  reply.setCookie("snapvault_session", session.id, { path: "/", httpOnly: true, sameSite: "lax" });
}

async function requireAuth(request: any, reply: any) {
  const sessionId = request.cookies.snapvault_session;
  if (!sessionId) return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Login required", details: {} } });
  const session = await db.getSession(sessionId);
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Login required", details: {} } });
  }
  const user = await db.getUser(session.userId);
  if (!user) return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Login required", details: {} } });
  request.user = user;
}

async function markResource(kind: "source" | "destination", resourceId: string, metadata?: Record<string, unknown>) {
  const updated = kind === "source"
    ? await db.updateSource(resourceId, { status: "healthy", lastTestedAt: now(), updatedAt: now() })
    : await db.updateDestination(resourceId, { status: "healthy", lastTestedAt: now(), updatedAt: now(), ...(metadata ? { metadata: { ...(await db.getDestination(resourceId))?.metadata, ...metadata } } : {}) });
  return { status: "healthy", resource: withoutSecrets(updated) };
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
  const integrations = await db.listMicrosoftIntegrations();
  const settings = await db.getSettings();
  const saved = integrationId
    ? integrations.find((item) => item.id === integrationId) ?? settings.microsoft
    : settings.microsoft ?? integrations[0];
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
      const settings = await db.getSettings();
      const systemTimezone = settings.timezone ?? "America/Sao_Paulo";
      const policies = await db.listPolicies();
      const sources = await db.listSources();
      const destinations = await db.listDestinations();
      const current = new Date();
      for (const policy of policies) {
        if (!policy.enabled || policy.schedule.type === "manual" || policy.schedule.type === "cron") continue;
        const tz = policy.schedule.timezone || systemTimezone;
        const { hhmm, weekday } = timeInZone(current, tz);
        const wantedTime = policy.schedule.time ?? "02:00";
        if (wantedTime !== hhmm) continue;
        if (policy.schedule.type === "weekly" && Number(policy.schedule.weekday ?? 0) !== weekday) continue;
        const key = `${policy.id}:${hhmm}:${current.toISOString().slice(0, 10)}`;
        if (scheduledKeys.has(key)) continue;
        scheduledKeys.add(key);
        const source = sources.find((item) => item.id === policy.sourceId);
        const destination = destinations.find((item) => item.id === policy.destinationId);
        if (source?.status !== "healthy" || destination?.status !== "healthy") continue;
        try {
          assertDestinationReady(destination);
        } catch (error) {
          app.log.warn({ policyId: policy.id, error }, "Scheduled backup skipped because destination is incomplete");
          continue;
        }
        const run = await db.createRun({
          id: id("run"),
          policyId: policy.id,
          sourceId: policy.sourceId,
          destinationId: policy.destinationId,
          trigger: "scheduled",
          status: "queued",
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          bytesWritten: null,
          errorCode: null,
          errorMessage: null,
          verificationStatus: "not_checked",
          verifiedAt: null,
          createdAt: now()
        });
        void executeBackupRun(db, run.id, config.stagingDir);
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
    await db.pool.end();
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
const stuck = await db.getStuckRuns();
if (stuck.length > 0) {
  await db.markRunsFailed(stuck.map((r) => r.id), "PROCESS_CRASH", "Execucao interrompida por reinicio inesperado do processo");
  app.log.warn({ stuckCount: stuck.length }, `boot: ${stuck.length} run(s) preso(s) marcado(s) como failed`);
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
