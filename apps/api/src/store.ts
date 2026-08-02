import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Database } from "./types.js";
import { id, now } from "./ids.js";

const emptyDb = (): Database => ({
  settings: { microsoft: null },
  microsoftIntegrations: [],
  users: [],
  sessions: [],
  sources: [],
  destinations: [],
  policies: [],
  runs: [],
  artifacts: [],
  logs: []
});

export class Store {
  constructor(private readonly filePath: string) {}

  async read(): Promise<Database> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return migrateDatabase({ ...emptyDb(), ...JSON.parse(raw) });
    } catch (error: any) {
      if (error?.code === "ENOENT") return emptyDb();
      throw error;
    }
  }

  async write(db: Database): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(db, null, 2));
    await rename(tmp, this.filePath);
  }

  async update<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
    const db = await this.read();
    const result = await fn(db);
    await this.write(db);
    return result;
  }
}

export const publicUser = (user: Database["users"][number]) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role
});

export const withoutSecrets = <T extends { secrets?: Record<string, string> }>(entity: T) => {
  const { secrets, ...rest } = entity;
  return rest;
};

export const publicMicrosoftIntegration = (microsoft: any) => {
  if (!microsoft) {
    return { configured: false, id: "", name: "", tenantId: "", clientId: "", clientSecretSet: false, status: "untested", lastTestedAt: null };
  }
  return {
    configured: true,
    id: microsoft.id,
    name: microsoft.name,
    tenantId: microsoft.tenantId,
    clientId: microsoft.clientId,
    clientSecretSet: Boolean(microsoft.encryptedClientSecret),
    status: microsoft.status,
    lastTestedAt: microsoft.lastTestedAt,
    updatedAt: microsoft.updatedAt
  };
};

export const publicMicrosoftConfig = (settings: Database["settings"]) => publicMicrosoftIntegration(settings?.microsoft);

function migrateDatabase(db: Database): Database {
  db.settings = db.settings ?? { microsoft: null };
  db.microsoftIntegrations = db.microsoftIntegrations ?? [];
  if (db.settings.microsoft && !db.microsoftIntegrations.some((item) => item.id === db.settings!.microsoft!.id)) {
    const stamp = now();
    const legacy = db.settings.microsoft as any;
    const integration = {
      id: legacy.id ?? id("ms"),
      name: legacy.name ?? "Microsoft principal",
      tenantId: legacy.tenantId,
      clientId: legacy.clientId,
      encryptedClientSecret: legacy.encryptedClientSecret,
      status: legacy.status ?? "untested",
      lastTestedAt: legacy.lastTestedAt ?? null,
      createdAt: legacy.createdAt ?? stamp,
      updatedAt: legacy.updatedAt ?? stamp
    };
    db.microsoftIntegrations.push(integration);
    db.settings.microsoft = integration;
  }
  const defaultIntegrationId = db.microsoftIntegrations[0]?.id;
  for (const destination of db.destinations) {
    if ((destination.type === "sharepoint" || destination.type === "onedrive") && destination.config?.mode === "graph" && defaultIntegrationId && !destination.config.microsoftIntegrationId) {
      destination.config.microsoftIntegrationId = defaultIntegrationId;
    }
    destination.metadata = destination.metadata ?? {};
    destination.archivedAt = destination.archivedAt ?? null;
  }
  for (const source of db.sources) {
    source.status = source.status ?? "untested";
    source.lastTestedAt = source.lastTestedAt ?? null;
    source.config.scope = source.config.scope ?? "single";
    if (source.status === "untested" && db.runs.some((run) => run.sourceId === source.id && (run.status === "recoverable" || run.verificationStatus === "restore_verified"))) {
      source.status = "healthy";
      source.lastTestedAt = source.lastTestedAt ?? now();
    }
  }
  for (const policy of db.policies) {
    const source = db.sources.find((item) => item.id === policy.sourceId);
    if (!source || policy.sourceScope) continue;
    if (source.type === "postgres") {
      policy.sourceScope = {
        mode: source.config.scope === "all" ? "all" : "single",
        database: String(source.config.database ?? "")
      };
    }
    if (source.type === "minio") {
      policy.sourceScope = {
        mode: source.config.scope === "all" ? "all" : "single",
        bucket: String(source.config.bucket ?? ""),
        prefix: String(source.config.prefix ?? "")
      };
    }
  }
  return db;
}
