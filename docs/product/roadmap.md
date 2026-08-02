# Roadmap

## Fase 0: Especificacao

- Documentacao de produto.
- Contratos de API.
- Contratos de adapters.
- Modelo de dados.
- Especificacao de seguranca.

## Fase 1: MVP funcional

- Scaffold do monorepo.
- Auth local.
- Primeiro acesso cria admin.
- CRUD de fontes.
- CRUD de destinos.
- CRUD de politicas.
- Worker basico.
- PostgreSQL via `pg_dump`.
- MinIO via `mc`.
- OneDrive/SharePoint via `rclone`.
- Historico de execucoes.
- Download/preparacao de restore.

## Fase 2: Confiabilidade

- Verificacao pos-upload.
- Retencao robusta.
- Logs estruturados melhores.
- Alertas por email/webhook.
- Melhor suporte a cancelamento.
- Testes de restore.

## Fase 3: Backups avancados

- pgBackRest.
- WAL archiving.
- PITR.
- MinIO versionado.
- Politicas de snapshot vs mirror.

## Fase 4: Mais destinos

- Amazon S3.
- Azure Blob.
- Google Drive.
- Dropbox.
- Backblaze B2.
- Wasabi.
- FTP.
- SFTP.

## Fase 5: Operacao avancada

- Multi-worker.
- RBAC completo.
- Auditoria exportavel.
- Metricas Prometheus.
- Health checks detalhados.
- Templates de deploy para Kubernetes.
