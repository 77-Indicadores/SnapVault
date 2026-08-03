export type Role = "admin" | "operator" | "viewer";
export type SourceType = "postgres" | "minio";
export type DestinationType = "onedrive" | "sharepoint" | "s3" | "azure_blob" | "google_drive" | "dropbox" | "b2" | "wasabi" | "ftp" | "sftp";
export type ResourceStatus = "untested" | "healthy" | "failed" | "archived";
export type RunStatus = "queued" | "running" | "success" | "verified" | "recoverable" | "restore_failed" | "failed" | "cancelled";
export type SourceScope = {
  mode: "single" | "all";
  database?: string;
  bucket?: string;
  prefix?: string;
};

export type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
};

export type Session = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

export type Source = {
  id: string;
  name: string;
  type: SourceType;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  status: ResourceStatus;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Destination = {
  id: string;
  name: string;
  type: DestinationType;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  basePath: string;
  status: ResourceStatus;
  lastTestedAt: string | null;
  metadata?: Record<string, unknown>;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MicrosoftIntegration = {
  id: string;
  name: string;
  tenantId: string;
  clientId: string;
  encryptedClientSecret: string;
  createdAt: string;
  updatedAt: string;
  lastTestedAt: string | null;
  status: ResourceStatus;
};

export type Policy = {
  id: string;
  name: string;
  sourceId: string;
  destinationId: string;
  sourceScope?: SourceScope;
  schedule: {
    type: "manual" | "daily" | "weekly" | "cron";
    cron?: string;
    time?: string;
    weekday?: number;
    timezone: string;
  };
  retention: {
    keepLast: number;
    keepDays: number;
  };
  options: {
    compression: "gzip" | "zstd";
    encryption: boolean;
    verifyAfterUpload: boolean;
  };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BackupRun = {
  id: string;
  policyId: string;
  sourceId: string;
  destinationId: string;
  trigger: "manual" | "scheduled" | "retry";
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  bytesWritten: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  verificationStatus?: "not_checked" | "integrity_verified" | "restore_verified";
  verifiedAt?: string | null;
  createdAt: string;
};

export type BackupArtifact = {
  id: string;
  runId: string;
  policyId: string;
  sourceId: string;
  destinationId: string;
  kind: "postgres_dump" | "minio_snapshot" | "manifest" | "log";
  path: string;
  checksumSha256: string | null;
  sizeBytes: number | null;
  verificationStatus?: "not_checked" | "integrity_verified";
  verifiedAt?: string | null;
  encrypted: boolean;
  compression: "gzip" | "zstd" | "none";
  createdAt: string;
};

export type JobLogEntry = {
  id: string;
  runId: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: Record<string, unknown>;
  createdAt: string;
};

export type Database = {
  settings?: {
    microsoft?: MicrosoftIntegration | null;
    timezone?: string;
  };
  microsoftIntegrations?: MicrosoftIntegration[];
  users: User[];
  sessions: Session[];
  sources: Source[];
  destinations: Destination[];
  policies: Policy[];
  runs: BackupRun[];
  artifacts: BackupArtifact[];
  logs: JobLogEntry[];
};
