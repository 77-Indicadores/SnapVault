import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Database } from "./types.js";

const emptyDb = (): Database => ({
  settings: { microsoft: null },
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
      return { ...emptyDb(), ...JSON.parse(raw) };
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

export const publicMicrosoftConfig = (settings: Database["settings"]) => {
  const microsoft = settings?.microsoft;
  if (!microsoft) {
    return { configured: false, tenantId: "", clientId: "", clientSecretSet: false, status: "untested", lastTestedAt: null };
  }
  return {
    configured: true,
    tenantId: microsoft.tenantId,
    clientId: microsoft.clientId,
    clientSecretSet: Boolean(microsoft.encryptedClientSecret),
    status: microsoft.status,
    lastTestedAt: microsoft.lastTestedAt,
    updatedAt: microsoft.updatedAt
  };
};
