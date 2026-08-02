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

O admin pode configurar uma ou mais integracoes Microsoft na interface. Cada integracao possui `Tenant ID`, `Client ID` e `Client Secret` proprios. Depois disso, a tela `Storage` escolhe qual integracao usar e lista:

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

## Origens

PostgreSQL e MinIO devem ser cadastrados em `Sources` antes de criar rotinas.

PostgreSQL:

- host;
- porta;
- usuario;
- senha criptografada.

MinIO:

- endpoint;
- access key;
- secret key criptografada.

O teste de Source lista databases PostgreSQL ou buckets MinIO apenas para provar permissao e alimentar os selects da rotina.

O escopo do que proteger fica na rotina de backup, nao na Source:

- PostgreSQL: um database ou todos os databases acessiveis;
- MinIO: um bucket, um bucket/prefixo ou todos os buckets acessiveis.

O wizard de backup combina `Source healthy` com `Storage healthy` e pergunta o escopo daquela rotina. A mesma Source pode ser reutilizada em varias rotinas com escopos diferentes.

Sources com rotinas, runs ou artefatos vinculados devem ser arquivadas, nao apagadas. Arquivar uma Source pausa rotinas vinculadas e preserva historico/restore. Reativar volta como `untested`, exigindo novo teste.

## Agendamento

Rotinas podem ser:

- `manual`: nunca rodam sozinhas;
- `daily`: rodam uma vez por dia no horario definido;
- `weekly`: rodam no dia da semana e horario definidos.

No MVP, o scheduler roda dentro da API e compara horario em UTC. Em producao, configure o horario pensando no UTC ate o suporte completo a timezones nomeados entrar.

## Restore

Depois de cada backup verificado, o SnapVault tenta baixar o artefato do destino, validar checksum e executar restore temporario. Apenas runs com esse teste aprovado ficam `recoverable`.

O restore manual pela interface exige escolher uma Source alvo `healthy` do mesmo tipo:

- PostgreSQL: escolher o database alvo no momento do restore;
- MinIO: escolher o bucket/prefixo alvo no momento do restore.

Essa restricao evita restaurar acidentalmente um backup amplo sobre um ambiente errado.

Observacao de integridade: backups MinIO em modo `all` sao verificados por extracao do pacote. Backups PostgreSQL em modo `all` usam `pg_dumpall`; para marcar `recoverable` com seguranca sera necessario restaurar em um cluster PostgreSQL temporario isolado. Ate essa etapa, o modo mais confiavel para producao e criar rotinas por database.

## Migracao local

Instalacoes antigas que tinham `settings.microsoft` singleton sao migradas automaticamente para `microsoftIntegrations[]` na leitura do banco local. Destinos Microsoft antigos passam a apontar para a primeira integracao migrada. Sources antigas com runs `recoverable` sao preservadas como saudaveis para nao bloquear rotinas ja validadas.

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
