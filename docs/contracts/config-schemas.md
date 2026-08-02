# Schemas de Configuracao

## PostgreSQL Source

```ts
type PostgresSourceConfig = {
  host: string;
  port: number;
  database: string;
  username: string;
  sslMode?: "disable" | "allow" | "prefer" | "require" | "verify-ca" | "verify-full";
  extraPgDumpArgs?: string[];
}

type PostgresSourceSecrets = {
  password: string;
}
```

Validacoes:

- `host` obrigatorio.
- `port` entre 1 e 65535.
- `database` obrigatorio.
- `username` obrigatorio.
- `extraPgDumpArgs` nao pode conter output path, password ou comandos shell.

## MinIO Source

```ts
type MinioSourceConfig = {
  endpoint: string;
  bucket: string;
  prefix?: string;
  region?: string;
  pathStyle?: boolean;
  tlsSkipVerify?: boolean;
}

type MinioSourceSecrets = {
  accessKey: string;
  secretKey: string;
}
```

Validacoes:

- `endpoint` deve ser URL HTTP ou HTTPS.
- `bucket` obrigatorio.
- `prefix` nao pode iniciar com `/`.
- `tlsSkipVerify` deve ser destacado na UI como inseguro.

## Rclone Destination

OneDrive e SharePoint usam a mesma base tecnica no MVP.

```ts
type RcloneDestinationConfig = {
  rcloneRemoteName: string;
  remotePath?: string;
  chunkSize?: string;
  transfers?: number;
  checkers?: number;
}
```

Validacoes:

- `rcloneRemoteName` obrigatorio.
- `remotePath` nao pode conter `..`.
- `transfers` entre 1 e 16.
- `checkers` entre 1 e 32.

## OneDrive Destination

```ts
type OneDriveDestinationConfig = RcloneDestinationConfig & {
  driveType?: "personal" | "business";
}
```

## SharePoint Destination

```ts
type SharePointDestinationConfig = RcloneDestinationConfig & {
  siteId?: string;
  driveId?: string;
}
```

## Policy Options

```ts
type PolicyOptions = {
  compression: "gzip" | "zstd";
  encryption: boolean;
  verifyAfterUpload: boolean;
  maxRuntimeMinutes?: number;
}
```

Validacoes:

- `maxRuntimeMinutes` padrao: 360.
- `maxRuntimeMinutes` minimo: 5.
- `maxRuntimeMinutes` maximo: 1440.

## Path final de destino

Todos os backups devem seguir o padrao:

```txt
{basePath}/{sourceSlug}/{yyyy}/{mm}/{dd}/{runId}/
```

Arquivos esperados:

```txt
manifest.json
backup.{ext}
job.log
```

Extensoes por tipo:

- PostgreSQL gzip: `dump.sql.gz`
- PostgreSQL zstd: `dump.sql.zst`
- MinIO gzip: `objects.tar.gz`
- MinIO zstd: `objects.tar.zst`
