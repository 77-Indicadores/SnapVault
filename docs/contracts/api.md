# Contratos da API

## Convencoes

- Prefixo: `/api/v1`.
- Entrada e saida em JSON.
- Datas em ISO 8601 UTC.
- IDs opacos com prefixo textual: `user_`, `src_`, `dst_`, `pol_`, `run_`.
- Erros seguem envelope padrao.

## Envelope de erro

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": {}
  }
}
```

## Auth

### GET `/setup/status`

Retorna se o primeiro usuario precisa ser criado.

Resposta:

```json
{
  "requiresSetup": true
}
```

### POST `/setup/admin`

Cria o primeiro admin. So funciona quando nao existe usuario.

Request:

```json
{
  "name": "Admin",
  "email": "admin@example.com",
  "password": "secret"
}
```

Resposta:

```json
{
  "user": {
    "id": "user_123",
    "name": "Admin",
    "email": "admin@example.com",
    "role": "admin"
  }
}
```

### POST `/auth/login`

Request:

```json
{
  "email": "admin@example.com",
  "password": "secret"
}
```

Resposta:

```json
{
  "user": {
    "id": "user_123",
    "name": "Admin",
    "email": "admin@example.com",
    "role": "admin"
  }
}
```

### POST `/auth/logout`

Encerra a sessao.

## Sources

### GET `/sources`

Lista fontes.

### POST `/sources`

Request PostgreSQL:

```json
{
  "name": "Production PostgreSQL",
  "type": "postgres",
  "config": {
    "host": "postgres",
    "port": 5432,
    "database": "app",
    "username": "postgres"
  },
  "secrets": {
    "password": "secret"
  }
}
```

Request MinIO:

```json
{
  "name": "App MinIO",
  "type": "minio",
  "config": {
    "endpoint": "http://minio:9000",
    "bucket": "uploads",
    "prefix": ""
  },
  "secrets": {
    "accessKey": "key",
    "secretKey": "secret"
  }
}
```

### POST `/sources/:id/test`

Testa conexao e atualiza status.

Resposta:

```json
{
  "status": "healthy",
  "message": "Connection successful"
}
```

## Destinations

### GET `/destinations`

Lista destinos.

### POST `/destinations`

Request OneDrive:

```json
{
  "name": "Company OneDrive",
  "type": "onedrive",
  "basePath": "/SnapVault",
  "config": {
    "rcloneRemoteName": "onedrive-company"
  }
}
```

Request SharePoint:

```json
{
  "name": "SharePoint Backups",
  "type": "sharepoint",
  "basePath": "/Shared Documents/SnapVault",
  "config": {
    "rcloneRemoteName": "sharepoint-company",
    "siteId": "optional"
  }
}
```

### POST `/destinations/:id/test`

Testa escrita, leitura e remocao de arquivo temporario.

## Policies

### GET `/policies`

Lista politicas.

### POST `/policies`

Request:

```json
{
  "name": "Daily production database",
  "sourceId": "src_123",
  "destinationId": "dst_123",
  "schedule": {
    "type": "daily",
    "time": "02:00",
    "timezone": "America/Sao_Paulo"
  },
  "retention": {
    "keepLast": 7,
    "keepDays": 30
  },
  "options": {
    "compression": "gzip",
    "encryption": true,
    "verifyAfterUpload": true
  },
  "enabled": true
}
```

### POST `/policies/:id/run`

Cria execucao manual.

Resposta:

```json
{
  "runId": "run_123",
  "status": "queued"
}
```

## Runs

### GET `/runs`

Filtros:

- `policyId`
- `sourceId`
- `status`
- `limit`
- `cursor`

### GET `/runs/:id`

Retorna execucao, logs resumidos e artefatos.

## Restores

### POST `/restores/prepare`

Request:

```json
{
  "artifactId": "artifact_123",
  "mode": "download"
}
```

Resposta:

```json
{
  "restoreId": "restore_123",
  "status": "running"
}
```
