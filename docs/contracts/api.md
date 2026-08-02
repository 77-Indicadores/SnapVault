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
    "endpoint": "http://minio:9000"
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

### PATCH `/sources/:id`

Edita nome, config e secrets. Quando secrets mudam, a origem volta para `untested` ate novo teste.

### DELETE `/sources/:id`

Remove apenas origem sem rotinas, runs ou artefatos vinculados. A requisicao nao precisa enviar body.

### POST `/sources/:id/archive`

Arquiva origem com historico e pausa rotinas vinculadas. Origem arquivada nao entra em novas rotinas.

### POST `/sources/:id/reactivate`

Reativa origem arquivada como `untested`. Ela precisa ser testada antes de ser usada.

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

### PATCH `/destinations/:id`

Edita nome, pasta base, config e metadata.

### DELETE `/destinations/:id`

Remove apenas destino sem rotinas, runs ou artefatos vinculados. Destino com historico deve ser arquivado.

### POST `/destinations/:id/archive`

Arquiva destino e pausa rotinas vinculadas.

### POST `/destinations/:id/reactivate`

Reativa destino como `untested`.

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
  "sourceScope": {
    "mode": "single",
    "database": "app"
  },
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

`sourceScope` pertence a rotina, nao a Source. Isso permite usar a mesma conexao PostgreSQL ou MinIO em varias rotinas, cada uma protegendo databases/buckets diferentes. Para MinIO, use `{ "mode": "single", "bucket": "uploads", "prefix": "optional/path" }`. Para todos os recursos acessiveis, use `{ "mode": "all" }`.

`schedule.type` aceita `manual`, `daily`, `weekly` e `cron`. Rotinas `manual` nunca sao disparadas pelo scheduler.

### PATCH `/policies/:id`

Edita `name`, `sourceId`, `destinationId`, `sourceScope`, `schedule`, `retention`, `options` e `enabled`. Nova origem e novo destino precisam estar `healthy`.

### DELETE `/policies/:id`

Remove a rotina. Runs e artefatos antigos continuam no historico.

### POST `/policies/:id/run`

Cria uma execucao manual da rotina.

## Restore

### POST `/runs/:id/test-restore`

Executa a mesma verificacao de restore usada automaticamente apos o backup.

Resposta:

```json
{
  "runId": "run_123",
  "status": "recoverable",
  "verificationStatus": "restore_verified",
  "checkedArtifacts": 12,
  "message": "Restore automatico validado"
}
```

### POST `/restores/prepare`

Retorna artefato e comando sugerido, sem executar escrita em destino.

### POST `/restores/execute`

Executa restore manual em uma origem alvo saudavel do mesmo tipo.

Request:

```json
{
  "artifactId": "art_123",
  "targetSourceId": "src_restore_target",
  "targetScope": {
    "mode": "single",
    "database": "restore_target"
  }
}
```

Resposta:

```json
{
  "restoreId": "rst_123",
  "status": "completed",
  "targetSourceId": "src_restore_target",
  "result": {
    "type": "postgres",
    "database": "restore_target"
  }
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
