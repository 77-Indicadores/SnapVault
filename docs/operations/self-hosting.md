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
