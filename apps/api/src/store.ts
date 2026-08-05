import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Database } from "./types.js";
import { id, now } from "./ids.js";

const emptyDb = (): Database => ({
  settings: { microsoft: null, timezone: "America/Sao_Paulo" },
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
  // Mutex: serializa todas as escritas para evitar race condition no .tmp → rename.
  // Sem isso, dois update() concorrentes (ex: logging durante backup) escrevem no
  // mesmo .tmp e o segundo rename falha com ENOENT porque o primeiro já moveu o arquivo.
  private _writeLock: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async read(): Promise<Database> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error: any) {
      if (error?.code === "ENOENT") return emptyDb();
      throw error;
    }
    try {
      return migrateDatabase({ ...emptyDb(), ...JSON.parse(raw) });
    } catch (error: any) {
      if (!(error instanceof SyntaxError)) throw error;
      return this._repair(raw);
    }
  }

  /**
   * Recupera um snapvault.json corrompido por uma escrita concorrente anterior.
   *
   * Como o arquivo é gerado com JSON.stringify(db, null, 2), o } raiz
   * sempre fica sozinho na última linha (coluna 0). O lixo de uma escrita
   * interrompida aparece depois desse }. Encontramos o último \n} para
   * localizar o fim real do JSON e truncamos o resto.
   *
   * Se nem assim for possível parsear, reseta para banco vazio — melhor
   * que ficar em loop infinito de crash.
   */
  private async _repair(raw: string): Promise<Database> {
    const cutoff = raw.lastIndexOf("\n}");
    if (cutoff >= 0) {
      try {
        const db = migrateDatabase({ ...emptyDb(), ...JSON.parse(raw.slice(0, cutoff + 2)) });
        await this.write(db); // persiste a versão reparada imediatamente
        console.warn("[store] snapvault.json estava corrompido — reparado automaticamente no boot");
        return db;
      } catch {}
    }
    console.error("[store] snapvault.json irrecuperavel — resetando para estado vazio");
    const db = emptyDb();
    await this.write(db);
    return db;
  }

  async write(db: Database): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(db, null, 2));
    await rename(tmp, this.filePath);
  }

  async update<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
    // Encadeia na fila — cada update aguarda o anterior antes de ler+escrever
    const task = this._writeLock.then(async () => {
      const db = await this.read();
      const result = await fn(db);
      await this.write(db);
      return result;
    });
    // Atualiza o lock ignorando erros para não bloquear a fila se uma operação falhar
    this._writeLock = task.then(() => {}, () => {});
    return task;
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
  db.settings = db.settings ?? { microsoft: null, timezone: "America/Sao_Paulo" };
  db.settings.timezone = db.settings.timezone ?? "America/Sao_Paulo";
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
    if ((destination.type === "sharepoint" || destination.type === "onedrive") && destination.config?.mode === "graph") {
      const hasDriveTarget = Boolean(destination.config.driveId || destination.config.userPrincipalName || destination.config.siteId || (destination.config.hostname && destination.config.sitePath));
      if (!hasDriveTarget && destination.status === "healthy") destination.status = "untested";
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
