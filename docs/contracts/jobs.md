# Contratos de Jobs

## Tipos de job

```ts
type JobType =
  | "backup.run"
  | "backup.verify"
  | "backup.retention"
  | "restore.prepare"
  | "connection.test";
```

## Estados

```ts
type JobStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled";
```

Transicoes permitidas:

- `queued -> running`
- `queued -> cancelled`
- `running -> success`
- `running -> failed`
- `running -> cancelled`

## Payload: backup.run

```json
{
  "type": "backup.run",
  "runId": "run_123",
  "policyId": "pol_123",
  "trigger": "manual"
}
```

## Log estruturado

```ts
type JobLogEntry = {
  id: string;
  runId: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: Record<string, unknown>;
  createdAt: string;
}
```

Regras:

- Logs devem ser append-only.
- Secrets devem ser mascarados.
- Mensagens de erro externas devem ser sanitizadas.

## Idempotencia

Execucao manual:

- Cada clique cria um novo `BackupRun`.

Execucao agendada:

- Para uma mesma politica, nao deve existir mais de um job `queued` ou `running` para a mesma janela de agenda.

Chave recomendada:

```txt
policy:{policyId}:scheduled:{yyyy-mm-ddThh:mm}:{timezone}
```

## Concorrencia

MVP:

- Uma politica nao pode ter dois backups simultaneos.
- Fontes diferentes podem executar em paralelo se configurado.
- Limite global padrao: 2 jobs simultaneos.

## Cancelamento

Cancelamento deve:

- Sinalizar o adapter.
- Encerrar processo filho quando aplicavel.
- Marcar job como `cancelled`.
- Limpar staging quando seguro.

## Retentativas

MVP:

- Sem retentativa automatica para backups.
- Retentativa manual pelo usuario.

Futuro:

- Retentativa configuravel para erros transientes.
- Backoff exponencial.
