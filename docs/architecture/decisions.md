# Decisoes Arquiteturais

## ADR-001: SnapVault sera self-hosted primeiro

Status: aceito.

Decisao:

- O projeto sera empacotado para Docker Compose antes de qualquer modelo SaaS.

Motivo:

- O publico inicial precisa controlar dados, segredos e backups dentro do proprio ambiente.

Consequencias:

- A instalacao deve ser simples.
- O app precisa funcionar bem atras de reverse proxy.
- O banco interno deve ser facil de salvar e migrar.

## ADR-002: rclone sera o primeiro adapter universal de destinos

Status: aceito.

Decisao:

- OneDrive e SharePoint serao implementados inicialmente usando rclone.

Motivo:

- rclone ja resolve autenticacao e transporte para muitos provedores.
- A mesma base permite adicionar destinos futuros com menos trabalho.

Consequencias:

- O sistema precisa detectar e validar `rclone`.
- Algumas limitacoes e throttling dos provedores devem ser expostos como erros amigaveis.
- No futuro, adapters nativos podem substituir rclone em destinos estrategicos.

## ADR-003: PostgreSQL com pg_dump no MVP e pgBackRest no modo avancado

Status: aceito.

Decisao:

- O MVP usa `pg_dump`.
- A arquitetura reserva espaco para `pgBackRest`.

Motivo:

- `pg_dump` e simples e atende ambientes pequenos.
- `pgBackRest` e mais apropriado para producao com PITR, WAL e incremental.

Consequencias:

- O MVP nao promete point-in-time recovery.
- A UI deve diferenciar "Backup simples" e "Backup avancado" quando pgBackRest entrar.

## ADR-004: Primeiro acesso cria o admin

Status: aceito.

Decisao:

- Se nao houver usuarios no banco interno, `/setup` permite criar o primeiro administrador.

Motivo:

- Padrao comum e ergonomico para apps self-hosted.

Consequencias:

- A rota de setup deve bloquear apos o primeiro usuario.
- Esse fluxo deve ser testado com cuidado.

## ADR-005: Backups devem gerar manifesto

Status: aceito.

Decisao:

- Toda execucao bem-sucedida gera `manifest.json`.

Motivo:

- O manifesto permite auditoria, restore, verificacao e evolucao de formato.

Consequencias:

- Mudancas futuras no formato precisam versionar `schemaVersion`.
