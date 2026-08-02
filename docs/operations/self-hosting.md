# Operacao Self-hosted

## Forma de distribuicao

MVP deve oferecer:

- Imagem Docker para web/API.
- Imagem Docker para worker.
- `compose.yaml` exemplo.
- Volume persistente para banco interno.
- Volume persistente para staging.
- Volume/config para rclone.

## Variaveis de ambiente

```env
SNAPVAULT_PUBLIC_URL=https://backup.example.com
SNAPVAULT_SECRET_KEY=change-me
SNAPVAULT_DATABASE_URL=file:/data/snapvault.db
SNAPVAULT_STAGING_DIR=/var/lib/snapvault/staging
SNAPVAULT_RCLONE_CONFIG=/config/rclone/rclone.conf
SNAPVAULT_MAX_CONCURRENT_JOBS=2
```

`SNAPVAULT_SECRET_KEY` e obrigatoria em producao. Ela criptografa segredos persistidos localmente, incluindo o `Client Secret` Microsoft cadastrado pela interface.

As variaveis abaixo sao opcionais e servem para bootstrap/dev. Em uso normal, configure pela tela `Settings > Integracao Microsoft`.

```env
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_TENANT_ID=
```

## Volumes

```txt
/data
/var/lib/snapvault/staging
/config/rclone
```

## Dependencias externas

MVP precisa dos binarios:

- `pg_dump`
- `mc`
- `rclone`

As imagens Docker oficiais do SnapVault devem incluir esses binarios ou validar claramente sua ausencia.

## Microsoft SharePoint / OneDrive

O admin configura `Tenant ID`, `Client ID` e `Client Secret` na interface. Depois disso, a tela `Storage` lista:

- sites SharePoint disponiveis;
- bibliotecas de documentos do site escolhido;
- usuarios para OneDrive quando a permissao do Graph permitir;
- quota total, usada e livre do drive.

O usuario nao deve digitar biblioteca manualmente no fluxo normal. O caminho final e:

```txt
Tenant Microsoft -> Site SharePoint -> Biblioteca -> Pasta base
```

Antes de ficar `healthy`, o Storage precisa passar por teste real de permissao: criar arquivo temporario, baixar, validar checksum, excluir e consultar quota.

Storages com rotinas, runs ou artefatos vinculados devem ser arquivados, nao apagados. O arquivamento remove o Storage da criacao de novas rotinas, pausa rotinas vinculadas e preserva historico/restore.

## Backup do proprio SnapVault

O banco interno contem configuracoes, historico e segredos criptografados.

Recomendacao:

- Fazer backup de `/data`.
- Guardar `SNAPVAULT_SECRET_KEY` fora do servidor.
- Sem a master key, segredos criptografados nao podem ser recuperados.

## Reverse proxy

Recomendado:

- Caddy.
- Traefik.
- Nginx.

Requisitos:

- HTTPS.
- Headers `X-Forwarded-*`.
- Limite razoavel de body size.

## Saude

Endpoints planejados:

- `GET /health`: processo vivo.
- `GET /ready`: app pronto, banco acessivel.
- `GET /metrics`: futuro, Prometheus.

## Atualizacao

MVP:

- Parar containers.
- Atualizar imagem.
- Rodar migrations na inicializacao.
- Subir novamente.

Futuro:

- Backup automatico do banco interno antes de migrations.
