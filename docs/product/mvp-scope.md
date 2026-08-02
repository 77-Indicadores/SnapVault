# Escopo do MVP

## Objetivo

Entregar uma versao funcional do SnapVault capaz de:

- Criar usuario administrador no primeiro acesso.
- Autenticar usuarios locais.
- Cadastrar fontes PostgreSQL e MinIO.
- Cadastrar destinos OneDrive e SharePoint via rclone.
- Criar politicas de backup automatizadas.
- Executar backups manualmente e por agenda.
- Registrar historico, logs e artefatos.
- Baixar ou preparar restore de backups existentes.

## Funcionalidades obrigatorias

### Onboarding

- Detectar banco interno sem usuario admin.
- Exibir tela de criacao do primeiro admin.
- Criar admin e iniciar sessao.
- Sugerir os proximos passos: fonte, destino, politica.

### Autenticacao

- Login com email e senha.
- Logout.
- Sessao via cookie HTTP-only.
- Senha armazenada com hash forte.

### Fontes

PostgreSQL:

- Host, porta, banco, usuario, senha.
- Teste de conexao.
- Backup com `pg_dump`.
- Saida comprimida.

MinIO:

- Endpoint, region opcional, access key, secret key.
- Bucket e prefixo opcional.
- Teste de acesso.
- Backup com MinIO Client.

### Destinos

- OneDrive via rclone.
- SharePoint via rclone.
- Teste de escrita/leitura com arquivo pequeno.
- Caminho base configuravel.

### Politicas

- Nome.
- Fonte.
- Destino.
- Agenda simples: diario, semanal ou cron.
- Retencao por quantidade e por dias.
- Ativo/inativo.

### Execucao

- Botao "executar agora".
- Worker processa jobs assincronamente.
- Status em tempo quase real por polling.
- Logs por job.

### Restore

- Listar backups.
- Baixar artefato.
- Preparar comando de restore para PostgreSQL.
- Restaurar MinIO para pasta temporaria ou prefixo alternativo.

## Funcionalidades adiadas

- pgBackRest completo com WAL/PITR.
- Restore destrutivo direto na origem.
- Usuarios com papeis avancados.
- Webhooks.
- Alertas por email/Slack.
- Cluster de workers.
- Destinos nativos sem rclone.
