# SnapVault

SnapVault e um projeto open source e self-hosted para automatizar backups de PostgreSQL e MinIO, com envio inicial para Microsoft OneDrive e Microsoft SharePoint.

O objetivo e oferecer uma experiencia simples, limpa e confiavel para usuarios tecnicos e pequenos times que precisam proteger dados sem montar scripts soltos, cron jobs dificeis de auditar ou stacks corporativas pesadas.

## Estado do projeto

MVP funcional em Docker:

- Frontend React/Vite em `apps/web`.
- API Fastify em `apps/api`.
- Onboarding no primeiro acesso com criacao do administrador.
- Backup real de PostgreSQL via `pg_dump`.
- Backup real de MinIO via `mc`.
- Upload para SharePoint/OneDrive via Microsoft Graph.
- Verificacao de integridade por checksum e validacao de arquivo.
- Restore automatico de teste apos backup.
- Status `recoverable` quando o backup foi criado, enviado, baixado e restaurado em ambiente temporario.
- Retencao por rotina: manter no minimo N backups e limpar antigos apos X dias.

> Projeto em evolucao. Use com cuidado em ambientes criticos e valide suas politicas de backup/restore antes de depender exclusivamente dele.

## Como rodar

Crie o `.env` a partir do exemplo:

```bash
cp .env.example .env
```

Configure:

```env
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_TENANT_ID=
SNAPVAULT_SECRET_KEY=
```

Suba com Docker:

```bash
docker compose up -d --build
```

Acesse:

```txt
http://localhost:8080
```

No primeiro acesso, crie o usuario administrador.

## Como funciona

1. Voce cria uma rotina de backup.
2. O SnapVault gera o dump/snapshot.
3. O arquivo e validado localmente.
4. O arquivo e enviado para Microsoft Graph.
5. O SnapVault baixa o artefato remoto.
6. O checksum remoto e conferido.
7. Um restore temporario e executado.
8. Se tudo passar, a execucao vira `recoverable`.
9. A politica de retencao remove backups antigos preservando o minimo configurado.

## Documentacao

- [Visao do produto](docs/product/vision.md)
- [Escopo do MVP](docs/product/mvp-scope.md)
- [Experiencia e interface](docs/product/ux-spec.md)
- [Arquitetura](docs/architecture/architecture.md)
- [Modelo de dados](docs/architecture/data-model.md)
- [Backup e restore](docs/architecture/backup-restore.md)
- [Decisoes arquiteturais](docs/architecture/decisions.md)
- [Contratos da API](docs/contracts/api.md)
- [Contratos de adapters](docs/contracts/adapters.md)
- [Contratos de jobs](docs/contracts/jobs.md)
- [Schemas de configuracao](docs/contracts/config-schemas.md)
- [Seguranca](docs/security/security.md)
- [Operacao self-hosted](docs/operations/self-hosting.md)
- [Desenvolvimento local](docs/operations/local-development.md)
- [Roadmap](docs/product/roadmap.md)
- [Glossario](docs/product/glossary.md)

## Principios

- Self-hosted por padrao.
- Primeiro acesso cria o primeiro administrador.
- Backups verificaveis, auditaveis e restauraveis.
- Destinos plugaveis desde o inicio.
- Interface simples, inspirada em produtos como Vercel: clara, fina, sem excesso visual.
- Ferramentas maduras por baixo, produto simples por cima.

## Decisoes base

- PostgreSQL tera modo simples via `pg_dump` no MVP e modo avancado via `pgBackRest` em versoes futuras.
- MinIO tera backup via `mc cp` no MVP.
- OneDrive e SharePoint sao integrados inicialmente via Microsoft Graph.
- A arquitetura deve permitir destinos futuros como S3, Azure Blob, Google Drive, Dropbox, Backblaze B2, Wasabi, FTP e SFTP.

## Licenca

MIT.
