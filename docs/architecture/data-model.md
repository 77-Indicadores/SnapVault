# Modelo de Dados

## Entidades

### User

```ts
type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: "admin" | "operator" | "viewer";
  createdAt: string;
  updatedAt: string;
}
```

Regras:

- O primeiro usuario criado recebe `admin`.
- MVP pode implementar apenas `admin`, mantendo o campo `role`.

### Source

```ts
type Source = {
  id: string;
  name: string;
  type: "postgres" | "minio";
  config: Record<string, unknown>;
  secretRefIds: string[];
  status: "untested" | "healthy" | "failed";
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### Destination

```ts
type Destination = {
  id: string;
  name: string;
  type: "onedrive" | "sharepoint" | "s3" | "azure_blob" | "google_drive" | "dropbox" | "b2" | "wasabi" | "ftp" | "sftp";
  config: Record<string, unknown>;
  secretRefIds: string[];
  basePath: string;
  status: "untested" | "healthy" | "failed";
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### Policy

```ts
type Policy = {
  id: string;
  name: string;
  sourceId: string;
  destinationId: string;
  schedule: {
    type: "daily" | "weekly" | "cron";
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
}
```

### BackupRun

```ts
type BackupRun = {
  id: string;
  policyId: string;
  sourceId: string;
  destinationId: string;
  trigger: "manual" | "scheduled" | "retry";
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  bytesWritten: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}
```

### BackupArtifact

```ts
type BackupArtifact = {
  id: string;
  runId: string;
  policyId: string;
  sourceId: string;
  destinationId: string;
  kind: "postgres_dump" | "minio_snapshot" | "manifest" | "log";
  path: string;
  checksumSha256: string | null;
  sizeBytes: number | null;
  encrypted: boolean;
  compression: "gzip" | "zstd" | "none";
  createdAt: string;
}
```

### Secret

```ts
type Secret = {
  id: string;
  name: string;
  encryptedValue: string;
  createdAt: string;
  updatedAt: string;
}
```

### AuditLog

```ts
type AuditLog = {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
```

## Invariantes

- Uma politica sempre aponta para exatamente uma fonte e um destino.
- Segredos nunca aparecem em respostas da API.
- Um backup bem-sucedido sempre gera pelo menos um manifesto.
- Um job com `success` deve ter `finishedAt`.
- Um job com `failed` deve ter `errorCode` e `errorMessage`.
