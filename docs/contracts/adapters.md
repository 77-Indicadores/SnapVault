# Contratos de Adapters

## Objetivo

Adapters isolam o core do SnapVault dos detalhes de cada fonte e destino.

O core deve depender de interfaces estaveis. A implementacao concreta pode usar binarios externos, SDKs ou APIs HTTP.

## SourceAdapter

```ts
type SourceAdapterKind = "postgres" | "minio";

interface SourceAdapter {
  kind: SourceAdapterKind;
  testConnection(input: TestSourceConnectionInput): Promise<TestConnectionResult>;
  estimate(input: EstimateBackupInput): Promise<BackupEstimate>;
  backup(input: BackupInput): Promise<BackupOutput>;
  prepareRestore(input: PrepareSourceRestoreInput): Promise<PrepareRestoreOutput>;
  restore(input: RestoreInput): Promise<RestoreOutput>;
}
```

### TestSourceConnectionInput

```ts
type TestSourceConnectionInput = {
  sourceId: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}
```

### BackupInput

```ts
type BackupInput = {
  runId: string;
  sourceId: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  stagingDir: string;
  logger: JobLogger;
  signal: AbortSignal;
}
```

### BackupOutput

```ts
type BackupOutput = {
  artifacts: LocalArtifact[];
  metadata: Record<string, unknown>;
}
```

## DestinationAdapter

```ts
type DestinationAdapterKind =
  | "onedrive"
  | "sharepoint"
  | "s3"
  | "azure_blob"
  | "google_drive"
  | "dropbox"
  | "b2"
  | "wasabi"
  | "ftp"
  | "sftp";

interface DestinationAdapter {
  kind: DestinationAdapterKind;
  testConnection(input: TestDestinationConnectionInput): Promise<TestConnectionResult>;
  put(input: PutObjectInput): Promise<RemoteObject>;
  get(input: GetObjectInput): Promise<LocalArtifact>;
  list(input: ListObjectsInput): Promise<RemoteObject[]>;
  delete(input: DeleteObjectInput): Promise<void>;
  stat(input: StatObjectInput): Promise<RemoteObject | null>;
}
```

## Rclone adapter

O adapter `rclone` sera a primeira implementacao concreta para OneDrive e SharePoint.

Responsabilidades:

- Validar se `rclone` esta instalado.
- Validar remote configurado.
- Executar `rclone copyto`, `rclone copy`, `rclone lsjson`, `rclone deletefile`.
- Capturar stdout/stderr.
- Mapear erros para codigos internos.

Erros esperados:

- `RCLONE_NOT_FOUND`
- `RCLONE_REMOTE_NOT_FOUND`
- `DESTINATION_AUTH_FAILED`
- `DESTINATION_QUOTA_EXCEEDED`
- `DESTINATION_RATE_LIMITED`
- `DESTINATION_WRITE_FAILED`

## PostgreSQL adapter

MVP:

- Usar `pg_dump`.
- Aceitar conexao por host/port/database/user/password.
- Produzir dump SQL.

Erros esperados:

- `PG_DUMP_NOT_FOUND`
- `POSTGRES_AUTH_FAILED`
- `POSTGRES_CONNECTION_FAILED`
- `POSTGRES_DUMP_FAILED`

## MinIO adapter

MVP:

- Usar `mc`.
- Validar alias temporario.
- Copiar bucket/prefixo para staging.

Erros esperados:

- `MC_NOT_FOUND`
- `MINIO_AUTH_FAILED`
- `MINIO_CONNECTION_FAILED`
- `MINIO_BUCKET_NOT_FOUND`
- `MINIO_COPY_FAILED`

## Regras de seguranca

- Secrets nunca devem ser escritos em logs.
- Comandos externos devem receber secrets por ambiente quando possivel.
- Argumentos devem ser montados como arrays, nao como shell string concatenada.
- Todo adapter deve respeitar `AbortSignal`.
