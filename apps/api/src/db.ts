import { Client, Pool } from "pg";
import type { BackupArtifact, BackupRun, Destination, JobLogEntry, MicrosoftIntegration, Policy, Role, Session, Source, User } from "./types.js";

export interface PgConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

// ─── row → domain mappers ────────────────────────────────────────────────────

function rowToUser(r: any): User {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    passwordHash: r.password_hash,
    role: r.role as Role,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  };
}

function rowToSession(r: any): Session {
  return {
    id: r.id,
    userId: r.user_id,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    expiresAt: r.expires_at instanceof Date ? r.expires_at.toISOString() : r.expires_at,
  };
}

function rowToMicrosoftIntegration(r: any): MicrosoftIntegration {
  return {
    id: r.id,
    name: r.name,
    tenantId: r.tenant_id,
    clientId: r.client_id,
    encryptedClientSecret: r.encrypted_client_secret,
    status: r.status,
    lastTestedAt: r.last_tested_at ? (r.last_tested_at instanceof Date ? r.last_tested_at.toISOString() : r.last_tested_at) : null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  };
}

function rowToSource(r: any): Source {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    config: r.config,
    secrets: r.secrets,
    status: r.status,
    lastTestedAt: r.last_tested_at ? (r.last_tested_at instanceof Date ? r.last_tested_at.toISOString() : r.last_tested_at) : null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  };
}

function rowToDestination(r: any): Destination {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    config: r.config,
    secrets: r.secrets,
    basePath: r.base_path,
    status: r.status,
    lastTestedAt: r.last_tested_at ? (r.last_tested_at instanceof Date ? r.last_tested_at.toISOString() : r.last_tested_at) : null,
    metadata: r.metadata ?? {},
    archivedAt: r.archived_at ? (r.archived_at instanceof Date ? r.archived_at.toISOString() : r.archived_at) : null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  };
}

function rowToPolicy(r: any): Policy {
  return {
    id: r.id,
    name: r.name,
    sourceId: r.source_id,
    destinationId: r.destination_id,
    sourceScope: r.source_scope ?? undefined,
    schedule: r.schedule,
    retention: r.retention,
    options: r.options,
    enabled: r.enabled,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  };
}

function rowToRun(r: any): BackupRun {
  return {
    id: r.id,
    policyId: r.policy_id,
    sourceId: r.source_id,
    destinationId: r.destination_id,
    trigger: r.trigger,
    status: r.status,
    startedAt: r.started_at ? (r.started_at instanceof Date ? r.started_at.toISOString() : r.started_at) : null,
    finishedAt: r.finished_at ? (r.finished_at instanceof Date ? r.finished_at.toISOString() : r.finished_at) : null,
    durationMs: r.duration_ms !== null && r.duration_ms !== undefined ? Number(r.duration_ms) : null,
    bytesWritten: r.bytes_written !== null && r.bytes_written !== undefined ? Number(r.bytes_written) : null,
    errorCode: r.error_code ?? null,
    errorMessage: r.error_message ?? null,
    verificationStatus: r.verification_status ?? "not_checked",
    verifiedAt: r.verified_at ? (r.verified_at instanceof Date ? r.verified_at.toISOString() : r.verified_at) : null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

function rowToArtifact(r: any): BackupArtifact {
  return {
    id: r.id,
    runId: r.run_id,
    policyId: r.policy_id,
    sourceId: r.source_id,
    destinationId: r.destination_id,
    kind: r.kind,
    path: r.path,
    checksumSha256: r.checksum_sha256 ?? null,
    sizeBytes: r.size_bytes !== null && r.size_bytes !== undefined ? Number(r.size_bytes) : null,
    verificationStatus: r.verification_status ?? "not_checked",
    verifiedAt: r.verified_at ? (r.verified_at instanceof Date ? r.verified_at.toISOString() : r.verified_at) : null,
    encrypted: r.encrypted,
    compression: r.compression,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

function rowToLog(r: any): JobLogEntry {
  return {
    id: r.id,
    runId: r.run_id,
    level: r.level,
    message: r.message,
    data: r.data ?? undefined,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

// ─── Settings row shape ───────────────────────────────────────────────────────

export interface SettingsRow {
  timezone: string;
  betterstack: { token: string; ingestingHost: string } | null;
  microsoft: MicrosoftIntegration | null;
}

// ─── AppDb interface ──────────────────────────────────────────────────────────

export interface AppDb {
  pool: Pool;

  // Settings
  getSettings(): Promise<SettingsRow>;
  setSetting(key: string, value: unknown): Promise<void>;

  // Users
  listUsers(): Promise<User[]>;
  getUser(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  countUsers(): Promise<number>;
  createUser(data: { id: string; email: string; name: string; passwordHash: string; role: Role }): Promise<User>;
  updateUser(id: string, data: Partial<Pick<User, "name" | "email" | "role" | "passwordHash">>): Promise<User>;
  deleteUser(id: string): Promise<void>;

  // Sessions
  getSession(id: string): Promise<Session | null>;
  createSession(data: { id: string; userId: string; expiresAt: string }): Promise<Session>;
  deleteSession(id: string): Promise<void>;
  cleanExpiredSessions(): Promise<void>;

  // Microsoft integrations
  listMicrosoftIntegrations(): Promise<MicrosoftIntegration[]>;
  getMicrosoftIntegration(id: string): Promise<MicrosoftIntegration | null>;
  upsertMicrosoftIntegration(data: MicrosoftIntegration): Promise<MicrosoftIntegration>;
  deleteMicrosoftIntegration(id: string): Promise<void>;

  // Sources
  listSources(): Promise<Source[]>;
  getSource(id: string): Promise<Source | null>;
  createSource(data: Source): Promise<Source>;
  updateSource(id: string, data: Partial<Source>): Promise<Source>;
  deleteSource(id: string): Promise<void>;

  // Destinations
  listDestinations(): Promise<Destination[]>;
  getDestination(id: string): Promise<Destination | null>;
  createDestination(data: Destination): Promise<Destination>;
  updateDestination(id: string, data: Partial<Destination>): Promise<Destination>;
  deleteDestination(id: string): Promise<void>;

  // Policies
  listPolicies(): Promise<Policy[]>;
  getPolicy(id: string): Promise<Policy | null>;
  createPolicy(data: Policy): Promise<Policy>;
  updatePolicy(id: string, data: Partial<Policy>): Promise<Policy>;
  deletePolicy(id: string): Promise<void>;

  // Runs
  listRuns(): Promise<BackupRun[]>;
  getRun(id: string): Promise<BackupRun | null>;
  createRun(data: BackupRun): Promise<BackupRun>;
  updateRun(id: string, data: Partial<BackupRun>): Promise<void>;
  getStuckRuns(): Promise<BackupRun[]>;
  markRunsFailed(ids: string[], errorCode: string, errorMessage: string): Promise<void>;

  // Artifacts
  listArtifacts(runId?: string): Promise<BackupArtifact[]>;
  getArtifact(id: string): Promise<BackupArtifact | null>;
  createArtifacts(data: BackupArtifact[]): Promise<void>;
  deleteArtifactsByRunIds(runIds: string[]): Promise<void>;

  // Logs
  getLogs(runId: string): Promise<JobLogEntry[]>;
  addLog(entry: JobLogEntry): Promise<void>;
  deleteLogsByRunIds(runIds: string[]): Promise<void>;
}

// ─── Migrations ───────────────────────────────────────────────────────────────

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS microsoft_integrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  encrypted_client_secret TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'untested',
  last_tested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  secrets JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'untested',
  last_tested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS destinations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  secrets JSONB NOT NULL DEFAULT '{}',
  base_path TEXT NOT NULL DEFAULT '/SnapVault',
  status TEXT NOT NULL DEFAULT 'untested',
  last_tested_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  source_scope JSONB,
  schedule JSONB NOT NULL,
  retention JSONB NOT NULL,
  options JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms BIGINT,
  bytes_written BIGINT,
  error_code TEXT,
  error_message TEXT,
  verification_status TEXT DEFAULT 'not_checked',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS runs_policy_id_idx ON runs(policy_id);
CREATE INDEX IF NOT EXISTS runs_status_idx ON runs(status);
CREATE INDEX IF NOT EXISTS runs_created_at_idx ON runs(created_at DESC);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  checksum_sha256 TEXT,
  size_bytes BIGINT,
  verification_status TEXT DEFAULT 'not_checked',
  verified_at TIMESTAMPTZ,
  encrypted BOOLEAN NOT NULL DEFAULT false,
  compression TEXT NOT NULL DEFAULT 'none',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS artifacts_run_id_idx ON artifacts(run_id);

CREATE TABLE IF NOT EXISTS job_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_logs_run_id_idx ON job_logs(run_id);
CREATE INDEX IF NOT EXISTS job_logs_created_at_idx ON job_logs(created_at);
`;

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function ensureDatabase(cfg: PgConfig) {
  const admin = new Client({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: "postgres" });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${cfg.database}`).catch(() => {});
  await admin.end();
}

export async function createDb(cfg: PgConfig): Promise<AppDb> {
  await ensureDatabase(cfg);

  const pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    max: 10,
  });

  // Run migrations
  await pool.query(MIGRATIONS);

  const db: AppDb = {
    pool,

    // ── Settings ──────────────────────────────────────────────────────────────
    async getSettings() {
      const res = await pool.query(`SELECT key, value FROM settings WHERE key IN ('timezone', 'betterstack', 'microsoft')`);
      const map: Record<string, any> = {};
      for (const row of res.rows) map[row.key] = row.value;
      return {
        timezone: (map.timezone as string) ?? "America/Sao_Paulo",
        betterstack: (map.betterstack as { token: string; ingestingHost: string } | null) ?? null,
        microsoft: (map.microsoft as MicrosoftIntegration | null) ?? null,
      };
    },

    async setSetting(key, value) {
      await pool.query(
        `INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
        [key, JSON.stringify(value)]
      );
    },

    // ── Users ─────────────────────────────────────────────────────────────────
    async listUsers() {
      const res = await pool.query(`SELECT * FROM users ORDER BY created_at`);
      return res.rows.map(rowToUser);
    },

    async getUser(id) {
      const res = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
      return res.rows[0] ? rowToUser(res.rows[0]) : null;
    },

    async getUserByEmail(email) {
      const res = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
      return res.rows[0] ? rowToUser(res.rows[0]) : null;
    },

    async countUsers() {
      const res = await pool.query(`SELECT COUNT(*)::int AS n FROM users`);
      return res.rows[0].n;
    },

    async createUser({ id, email, name, passwordHash, role }) {
      const res = await pool.query(
        `INSERT INTO users(id, email, name, password_hash, role) VALUES($1, $2, $3, $4, $5) RETURNING *`,
        [id, email, name, passwordHash, role]
      );
      return rowToUser(res.rows[0]);
    },

    async updateUser(id, data) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (data.name !== undefined)         { sets.push(`name = $${i++}`);          vals.push(data.name); }
      if (data.email !== undefined)        { sets.push(`email = $${i++}`);         vals.push(data.email); }
      if (data.role !== undefined)         { sets.push(`role = $${i++}`);          vals.push(data.role); }
      if (data.passwordHash !== undefined) { sets.push(`password_hash = $${i++}`); vals.push(data.passwordHash); }
      sets.push(`updated_at = NOW()`);
      vals.push(id);
      const res = await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, vals);
      if (!res.rows[0]) throw new Error("User not found");
      return rowToUser(res.rows[0]);
    },

    async deleteUser(id) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    },

    // ── Sessions ──────────────────────────────────────────────────────────────
    async getSession(id) {
      const res = await pool.query(`SELECT * FROM sessions WHERE id = $1`, [id]);
      return res.rows[0] ? rowToSession(res.rows[0]) : null;
    },

    async createSession({ id, userId, expiresAt }) {
      const res = await pool.query(
        `INSERT INTO sessions(id, user_id, expires_at) VALUES($1, $2, $3) RETURNING *`,
        [id, userId, expiresAt]
      );
      return rowToSession(res.rows[0]);
    },

    async deleteSession(id) {
      await pool.query(`DELETE FROM sessions WHERE id = $1`, [id]);
    },

    async cleanExpiredSessions() {
      await pool.query(`DELETE FROM sessions WHERE expires_at <= NOW()`);
    },

    // ── Microsoft integrations ────────────────────────────────────────────────
    async listMicrosoftIntegrations() {
      const res = await pool.query(`SELECT * FROM microsoft_integrations ORDER BY created_at`);
      return res.rows.map(rowToMicrosoftIntegration);
    },

    async getMicrosoftIntegration(id) {
      const res = await pool.query(`SELECT * FROM microsoft_integrations WHERE id = $1`, [id]);
      return res.rows[0] ? rowToMicrosoftIntegration(res.rows[0]) : null;
    },

    async upsertMicrosoftIntegration(data) {
      const res = await pool.query(
        `INSERT INTO microsoft_integrations(id, name, tenant_id, client_id, encrypted_client_secret, status, last_tested_at, created_at, updated_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT(id) DO UPDATE SET
           name = EXCLUDED.name,
           tenant_id = EXCLUDED.tenant_id,
           client_id = EXCLUDED.client_id,
           encrypted_client_secret = EXCLUDED.encrypted_client_secret,
           status = EXCLUDED.status,
           last_tested_at = EXCLUDED.last_tested_at,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [data.id, data.name, data.tenantId, data.clientId, data.encryptedClientSecret, data.status, data.lastTestedAt, data.createdAt, data.updatedAt]
      );
      return rowToMicrosoftIntegration(res.rows[0]);
    },

    async deleteMicrosoftIntegration(id) {
      await pool.query(`DELETE FROM microsoft_integrations WHERE id = $1`, [id]);
    },

    // ── Sources ───────────────────────────────────────────────────────────────
    async listSources() {
      const res = await pool.query(`SELECT * FROM sources ORDER BY created_at`);
      return res.rows.map(rowToSource);
    },

    async getSource(id) {
      const res = await pool.query(`SELECT * FROM sources WHERE id = $1`, [id]);
      return res.rows[0] ? rowToSource(res.rows[0]) : null;
    },

    async createSource(data) {
      const res = await pool.query(
        `INSERT INTO sources(id, name, type, config, secrets, status, last_tested_at, created_at, updated_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [data.id, data.name, data.type, JSON.stringify(data.config), JSON.stringify(data.secrets), data.status, data.lastTestedAt, data.createdAt, data.updatedAt]
      );
      return rowToSource(res.rows[0]);
    },

    async updateSource(id, data) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (data.name !== undefined)         { sets.push(`name = $${i++}`);           vals.push(data.name); }
      if (data.type !== undefined)         { sets.push(`type = $${i++}`);           vals.push(data.type); }
      if (data.config !== undefined)       { sets.push(`config = $${i++}`);         vals.push(JSON.stringify(data.config)); }
      if (data.secrets !== undefined)      { sets.push(`secrets = $${i++}`);        vals.push(JSON.stringify(data.secrets)); }
      if (data.status !== undefined)       { sets.push(`status = $${i++}`);         vals.push(data.status); }
      if (data.lastTestedAt !== undefined) { sets.push(`last_tested_at = $${i++}`); vals.push(data.lastTestedAt); }
      sets.push(`updated_at = NOW()`);
      vals.push(id);
      const res = await pool.query(`UPDATE sources SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, vals);
      if (!res.rows[0]) throw new Error("Source not found");
      return rowToSource(res.rows[0]);
    },

    async deleteSource(id) {
      await pool.query(`DELETE FROM sources WHERE id = $1`, [id]);
    },

    // ── Destinations ──────────────────────────────────────────────────────────
    async listDestinations() {
      const res = await pool.query(`SELECT * FROM destinations ORDER BY created_at`);
      return res.rows.map(rowToDestination);
    },

    async getDestination(id) {
      const res = await pool.query(`SELECT * FROM destinations WHERE id = $1`, [id]);
      return res.rows[0] ? rowToDestination(res.rows[0]) : null;
    },

    async createDestination(data) {
      const res = await pool.query(
        `INSERT INTO destinations(id, name, type, config, secrets, base_path, status, last_tested_at, metadata, archived_at, created_at, updated_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [data.id, data.name, data.type, JSON.stringify(data.config), JSON.stringify(data.secrets), data.basePath, data.status, data.lastTestedAt, JSON.stringify(data.metadata ?? {}), data.archivedAt ?? null, data.createdAt, data.updatedAt]
      );
      return rowToDestination(res.rows[0]);
    },

    async updateDestination(id, data) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (data.name !== undefined)         { sets.push(`name = $${i++}`);           vals.push(data.name); }
      if (data.type !== undefined)         { sets.push(`type = $${i++}`);           vals.push(data.type); }
      if (data.config !== undefined)       { sets.push(`config = $${i++}`);         vals.push(JSON.stringify(data.config)); }
      if (data.secrets !== undefined)      { sets.push(`secrets = $${i++}`);        vals.push(JSON.stringify(data.secrets)); }
      if (data.basePath !== undefined)     { sets.push(`base_path = $${i++}`);      vals.push(data.basePath); }
      if (data.status !== undefined)       { sets.push(`status = $${i++}`);         vals.push(data.status); }
      if (data.lastTestedAt !== undefined) { sets.push(`last_tested_at = $${i++}`); vals.push(data.lastTestedAt); }
      if (data.metadata !== undefined)     { sets.push(`metadata = $${i++}`);       vals.push(JSON.stringify(data.metadata)); }
      if (data.archivedAt !== undefined)   { sets.push(`archived_at = $${i++}`);    vals.push(data.archivedAt); }
      sets.push(`updated_at = NOW()`);
      vals.push(id);
      const res = await pool.query(`UPDATE destinations SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, vals);
      if (!res.rows[0]) throw new Error("Destination not found");
      return rowToDestination(res.rows[0]);
    },

    async deleteDestination(id) {
      await pool.query(`DELETE FROM destinations WHERE id = $1`, [id]);
    },

    // ── Policies ──────────────────────────────────────────────────────────────
    async listPolicies() {
      const res = await pool.query(`SELECT * FROM policies ORDER BY created_at`);
      return res.rows.map(rowToPolicy);
    },

    async getPolicy(id) {
      const res = await pool.query(`SELECT * FROM policies WHERE id = $1`, [id]);
      return res.rows[0] ? rowToPolicy(res.rows[0]) : null;
    },

    async createPolicy(data) {
      const res = await pool.query(
        `INSERT INTO policies(id, name, source_id, destination_id, source_scope, schedule, retention, options, enabled, created_at, updated_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [data.id, data.name, data.sourceId, data.destinationId, data.sourceScope ? JSON.stringify(data.sourceScope) : null, JSON.stringify(data.schedule), JSON.stringify(data.retention), JSON.stringify(data.options), data.enabled, data.createdAt, data.updatedAt]
      );
      return rowToPolicy(res.rows[0]);
    },

    async updatePolicy(id, data) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (data.name !== undefined)          { sets.push(`name = $${i++}`);           vals.push(data.name); }
      if (data.sourceId !== undefined)      { sets.push(`source_id = $${i++}`);      vals.push(data.sourceId); }
      if (data.destinationId !== undefined) { sets.push(`destination_id = $${i++}`); vals.push(data.destinationId); }
      if ("sourceScope" in data)            { sets.push(`source_scope = $${i++}`);   vals.push(data.sourceScope ? JSON.stringify(data.sourceScope) : null); }
      if (data.schedule !== undefined)      { sets.push(`schedule = $${i++}`);       vals.push(JSON.stringify(data.schedule)); }
      if (data.retention !== undefined)     { sets.push(`retention = $${i++}`);      vals.push(JSON.stringify(data.retention)); }
      if (data.options !== undefined)       { sets.push(`options = $${i++}`);        vals.push(JSON.stringify(data.options)); }
      if (data.enabled !== undefined)       { sets.push(`enabled = $${i++}`);        vals.push(data.enabled); }
      sets.push(`updated_at = NOW()`);
      vals.push(id);
      const res = await pool.query(`UPDATE policies SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, vals);
      if (!res.rows[0]) throw new Error("Policy not found");
      return rowToPolicy(res.rows[0]);
    },

    async deletePolicy(id) {
      await pool.query(`DELETE FROM policies WHERE id = $1`, [id]);
    },

    // ── Runs ──────────────────────────────────────────────────────────────────
    async listRuns() {
      const res = await pool.query(`SELECT * FROM runs ORDER BY created_at DESC`);
      return res.rows.map(rowToRun);
    },

    async getRun(id) {
      const res = await pool.query(`SELECT * FROM runs WHERE id = $1`, [id]);
      return res.rows[0] ? rowToRun(res.rows[0]) : null;
    },

    async createRun(data) {
      const res = await pool.query(
        `INSERT INTO runs(id, policy_id, source_id, destination_id, trigger, status, started_at, finished_at, duration_ms, bytes_written, error_code, error_message, verification_status, verified_at, created_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
        [data.id, data.policyId, data.sourceId, data.destinationId, data.trigger, data.status, data.startedAt, data.finishedAt, data.durationMs, data.bytesWritten, data.errorCode, data.errorMessage, data.verificationStatus ?? "not_checked", data.verifiedAt ?? null, data.createdAt]
      );
      return rowToRun(res.rows[0]);
    },

    async updateRun(id, data) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (data.status !== undefined)             { sets.push(`status = $${i++}`);              vals.push(data.status); }
      if (data.startedAt !== undefined)          { sets.push(`started_at = $${i++}`);          vals.push(data.startedAt); }
      if (data.finishedAt !== undefined)         { sets.push(`finished_at = $${i++}`);         vals.push(data.finishedAt); }
      if (data.durationMs !== undefined)         { sets.push(`duration_ms = $${i++}`);         vals.push(data.durationMs); }
      if (data.bytesWritten !== undefined)       { sets.push(`bytes_written = $${i++}`);       vals.push(data.bytesWritten); }
      if (data.errorCode !== undefined)          { sets.push(`error_code = $${i++}`);          vals.push(data.errorCode); }
      if (data.errorMessage !== undefined)       { sets.push(`error_message = $${i++}`);       vals.push(data.errorMessage); }
      if (data.verificationStatus !== undefined) { sets.push(`verification_status = $${i++}`); vals.push(data.verificationStatus); }
      if (data.verifiedAt !== undefined)         { sets.push(`verified_at = $${i++}`);         vals.push(data.verifiedAt); }
      if (sets.length === 0) return;
      vals.push(id);
      await pool.query(`UPDATE runs SET ${sets.join(", ")} WHERE id = $${i}`, vals);
    },

    async getStuckRuns() {
      const res = await pool.query(`SELECT * FROM runs WHERE status IN ('queued', 'running')`);
      return res.rows.map(rowToRun);
    },

    async markRunsFailed(ids, errorCode, errorMessage) {
      if (ids.length === 0) return;
      const placeholders = ids.map((_, idx) => `$${idx + 4}`).join(", ");
      await pool.query(
        `UPDATE runs SET status = 'failed', finished_at = NOW(), error_code = $1, error_message = $2, duration_ms = EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, created_at))) * 1000 WHERE id IN (${placeholders}) AND $3 = $3`,
        [errorCode, errorMessage, true, ...ids]
      );
    },

    // ── Artifacts ─────────────────────────────────────────────────────────────
    async listArtifacts(runId) {
      if (runId) {
        const res = await pool.query(`SELECT * FROM artifacts WHERE run_id = $1 ORDER BY created_at`, [runId]);
        return res.rows.map(rowToArtifact);
      }
      const res = await pool.query(`SELECT * FROM artifacts ORDER BY created_at`);
      return res.rows.map(rowToArtifact);
    },

    async getArtifact(id) {
      const res = await pool.query(`SELECT * FROM artifacts WHERE id = $1`, [id]);
      return res.rows[0] ? rowToArtifact(res.rows[0]) : null;
    },

    async createArtifacts(data) {
      if (data.length === 0) return;
      for (const a of data) {
        await pool.query(
          `INSERT INTO artifacts(id, run_id, policy_id, source_id, destination_id, kind, path, checksum_sha256, size_bytes, verification_status, verified_at, encrypted, compression, created_at)
           VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [a.id, a.runId, a.policyId, a.sourceId, a.destinationId, a.kind, a.path, a.checksumSha256, a.sizeBytes, a.verificationStatus ?? "not_checked", a.verifiedAt ?? null, a.encrypted, a.compression, a.createdAt]
        );
      }
    },

    async deleteArtifactsByRunIds(runIds) {
      if (runIds.length === 0) return;
      const placeholders = runIds.map((_, i) => `$${i + 1}`).join(", ");
      await pool.query(`DELETE FROM artifacts WHERE run_id IN (${placeholders})`, runIds);
    },

    // ── Logs ──────────────────────────────────────────────────────────────────
    async getLogs(runId) {
      const res = await pool.query(`SELECT * FROM job_logs WHERE run_id = $1 ORDER BY created_at`, [runId]);
      return res.rows.map(rowToLog);
    },

    async addLog(entry) {
      await pool.query(
        `INSERT INTO job_logs(id, run_id, level, message, data, created_at) VALUES($1, $2, $3, $4, $5, $6)`,
        [entry.id, entry.runId, entry.level, entry.message, entry.data ? JSON.stringify(entry.data) : null, entry.createdAt]
      );
    },

    async deleteLogsByRunIds(runIds) {
      if (runIds.length === 0) return;
      const placeholders = runIds.map((_, i) => `$${i + 1}`).join(", ");
      await pool.query(`DELETE FROM job_logs WHERE run_id IN (${placeholders})`, runIds);
    },
  };

  return db;
}
