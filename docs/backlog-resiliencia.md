# Documento Mestre de Implementação — Resiliência e Observabilidade
## Agent-Oriented Execution Plan

**Versão:** 1.0
**Base:** Análise de crashes em produção — agosto 2026
**Branch de origem:** `main`
**Target branch:** `fix/resiliencia`

---

## Como usar este documento

Este documento é escrito para execução por agentes de IA.

**Cada task card é autossuficiente.** O agente não precisa ler outras seções para executar uma task.

**Protocolo de execução por agente:**
1. Ler a task card completa antes de qualquer ação
2. Executar `read` nos arquivos listados em "Arquivos a ler"
3. Executar as mudanças na ordem listada
4. Rodar os comandos de verificação
5. Reportar resultado: PASS ou FAIL (detalhar o que falhou)

**Protocolo de dependências:**
- Tasks com `Dependências: nenhuma` podem rodar em paralelo
- Tasks com dependência explícita só iniciam após o PASS da task anterior

**Estrutura de branches:**
```
main
  └── fix/resiliencia   ← todas as tasks desta fase
```

---

## Índice de tasks

| ID | Título | Dependências | Esforço |
|---|---|---|---|
| [F0-01](#f0-01--healthcheck-real-no-composeyaml) | Healthcheck real no compose.yaml | nenhuma | XS |
| [F0-02](#f0-02--integrar-betterstack-logtail-ao-fastify) | Integrar BetterStack Logtail ao Fastify | nenhuma | XS |
| [F0-03](#f0-03--capturar-uncaughtexception-e-unhandledrejection) | Capturar uncaughtException e unhandledRejection | F0-02 | XS |
| [F0-04](#f0-04--marcar-runs-presos-como-failed-no-boot) | Marcar runs presos como failed no boot | F0-03 | S |
| [F0-05](#f0-05--configurar-uptime-monitor-e-alertas-no-betterstack) | Configurar uptime monitor e alertas no BetterStack | F0-02 | XS |

**Legenda:** `XS = horas | S = ~1 dia | M = 2-3 dias | L = 4-5 dias`

---

# FASE 0 — Estabilidade de Boot e Observabilidade

> Gate: todos os F0 em PASS antes de qualquer deploy em produção.

---

## F0-01 — Healthcheck real no compose.yaml

**Status:** TODO
**Branch:** `fix/resiliencia`
**Dependências:** nenhuma
**Esforço:** XS

### Contexto

O `compose.yaml` na raiz usa `depends_on` simples (sem condição) para garantir que `api` só suba após `postgres` e `minio`. Porém `depends_on` sem `condition: service_healthy` apenas espera o container existir — não espera o processo dentro do container estar pronto para aceitar conexões.

Na prática: o container do Postgres sobe em ~1s mas o processo `postgres` leva 3-5s para aceitar conexões. A `api` tenta conectar nesse intervalo, falha com erro de autenticação, e o processo Node morre. Isso causou os 2 crashes registrados em `2026-08-04T20:31:49`.

Sem healthcheck configurado, o Coolify também não consegue validar o estado real do stack e exibe `status: running:unknown`.

O Dockerfile da `api` já instala `curl` e `mc` (MinIO client), então os comandos de healthcheck estão disponíveis na imagem. O endpoint `/health` já existe em `server.ts` e retorna `{"status":"ok"}`.

### Arquivos a ler antes de executar

- `compose.yaml` — arquivo que será modificado integralmente

### Mudança 1 — Adicionar healthchecks e conditions

**Arquivo:** `compose.yaml`

**Antes:**
```yaml
services:
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    env_file:
      - .env
    environment:
      PORT: 4000
      HOST: 0.0.0.0
      SNAPVAULT_DATABASE_PATH: /data/snapvault.json
      SNAPVAULT_STAGING_DIR: /staging
      SNAPVAULT_WEB_ORIGIN: http://localhost:8080
      SNAPVAULT_SECRET_KEY: ${SNAPVAULT_SECRET_KEY:-local-dev-secret}
    volumes:
      - snapvault-data:/data
      - snapvault-staging:/staging
      - ./tmp/rclone:/config/rclone
    ports:
      - "4000:4000"
    depends_on:
      - postgres
      - minio

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    ports:
      - "8080:80"
    depends_on:
      - api

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pg-data:/var/lib/postgresql/data

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio-data:/data

volumes:
  snapvault-data:
  snapvault-staging:
  pg-data:
  minio-data:
```

**Depois:**
```yaml
services:
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    env_file:
      - .env
    environment:
      PORT: 4000
      HOST: 0.0.0.0
      SNAPVAULT_DATABASE_PATH: /data/snapvault.json
      SNAPVAULT_STAGING_DIR: /staging
      SNAPVAULT_WEB_ORIGIN: http://localhost:8080
      SNAPVAULT_SECRET_KEY: ${SNAPVAULT_SECRET_KEY:-local-dev-secret}
    volumes:
      - snapvault-data:/data
      - snapvault-staging:/staging
      - ./tmp/rclone:/config/rclone
    ports:
      - "4000:4000"
    depends_on:
      postgres:
        condition: service_healthy
      minio:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-fs", "http://localhost:4000/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 15s

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    ports:
      - "8080:80"
    depends_on:
      api:
        condition: service_healthy

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pg-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 10s

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio-data:/data
    healthcheck:
      test: ["CMD", "curl", "-fs", "http://localhost:9000/minio/health/live"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 15s

volumes:
  snapvault-data:
  snapvault-staging:
  pg-data:
  minio-data:
```

### Verificação

```bash
docker compose up -d
sleep 40
docker compose ps
curl -s http://localhost:4000/health
```

### Critério PASS

- [ ] `docker compose ps` mostra `api`, `postgres` e `minio` com status `healthy`
- [ ] `docker compose logs api` não contém erros de conexão com Postgres no boot
- [ ] `curl -s http://localhost:4000/health` retorna `{"status":"ok"}`

---

## F0-02 — Integrar BetterStack Logtail ao Fastify

**Status:** TODO
**Branch:** `fix/resiliencia`
**Dependências:** nenhuma
**Esforço:** XS

### Contexto

Hoje os logs do Fastify vão para o stdout do container e não são persistidos. O Coolify exibe os logs em tempo real no painel mas não os indexa nem permite consultas históricas. Quando o processo crashou, os logs do momento do crash se perderam.

O Fastify usa `pino` internamente como logger. O BetterStack publica o pacote `@logtail/pino` que funciona como um transport pino — os logs continuam saindo no stdout (para o Coolify ler) e simultaneamente são enviados para o BetterStack via HTTPS.

A integração exige:
1. Instalar `@logtail/pino` como dependência em `apps/api`
2. Criar o transport pino na inicialização do Fastify em `server.ts`
3. Adicionar a variável de ambiente `BETTERSTACK_SOURCE_TOKEN` no `compose.yaml` e no Coolify

O token de source é obtido no painel do BetterStack em **Logs → Sources → New Source → Node.js**.

### Arquivos a ler antes de executar

- `apps/api/package.json` — para confirmar dependências atuais antes de adicionar
- `apps/api/src/server.ts` — linha com `Fastify({ logger: true })` que será modificada
- `apps/api/src/config.ts` — onde adicionar a leitura da env var do token
- `compose.yaml` — onde adicionar a env var `BETTERSTACK_SOURCE_TOKEN`

### Mudança 1 — Instalar dependência

```bash
npm install @logtail/pino --workspace apps/api
```

### Mudança 2 — Adicionar token ao config

**Arquivo:** `apps/api/src/config.ts`

**Antes:**
```ts
export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  databasePath: process.env.SNAPVAULT_DATABASE_PATH ?? resolve(process.cwd(), "../../data/snapvault.json"),
  stagingDir: process.env.SNAPVAULT_STAGING_DIR ?? resolve(process.cwd(), "../../staging"),
  cookieSecret: process.env.SNAPVAULT_SECRET_KEY ?? "dev-secret-change-me",
  webOrigin: process.env.SNAPVAULT_WEB_ORIGIN ?? "http://localhost:5173",
  microsoft: {
    clientId: process.env.MS_CLIENT_ID ?? "",
    clientSecret: process.env.MS_CLIENT_SECRET ?? "",
    tenantId: process.env.MS_TENANT_ID ?? ""
  }
};
```

**Depois:**
```ts
export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  databasePath: process.env.SNAPVAULT_DATABASE_PATH ?? resolve(process.cwd(), "../../data/snapvault.json"),
  stagingDir: process.env.SNAPVAULT_STAGING_DIR ?? resolve(process.cwd(), "../../staging"),
  cookieSecret: process.env.SNAPVAULT_SECRET_KEY ?? "dev-secret-change-me",
  webOrigin: process.env.SNAPVAULT_WEB_ORIGIN ?? "http://localhost:5173",
  betterstackToken: process.env.BETTERSTACK_SOURCE_TOKEN ?? "",
  microsoft: {
    clientId: process.env.MS_CLIENT_ID ?? "",
    clientSecret: process.env.MS_CLIENT_SECRET ?? "",
    tenantId: process.env.MS_TENANT_ID ?? ""
  }
};
```

### Mudança 3 — Configurar o transport pino no Fastify

**Arquivo:** `apps/api/src/server.ts`

**Antes:**
```ts
const store = new Store(config.databasePath);
const app = Fastify({ logger: true });
```

**Depois:**
```ts
const store = new Store(config.databasePath);

const loggerOptions = config.betterstackToken
  ? {
      level: "info",
      transport: {
        targets: [
          { target: "pino-pretty", options: { colorize: true }, level: "info" },
          { target: "@logtail/pino", options: { sourceToken: config.betterstackToken }, level: "info" }
        ]
      }
    }
  : { level: "info" };

const app = Fastify({ logger: loggerOptions });
```

### Mudança 4 — Adicionar variável de ambiente no compose.yaml

**Arquivo:** `compose.yaml`

Localizar a seção `environment` do serviço `api` e adicionar a variável:

**Antes:**
```yaml
    environment:
      PORT: 4000
      HOST: 0.0.0.0
      SNAPVAULT_DATABASE_PATH: /data/snapvault.json
      SNAPVAULT_STAGING_DIR: /staging
      SNAPVAULT_WEB_ORIGIN: http://localhost:8080
      SNAPVAULT_SECRET_KEY: ${SNAPVAULT_SECRET_KEY:-local-dev-secret}
```

**Depois:**
```yaml
    environment:
      PORT: 4000
      HOST: 0.0.0.0
      SNAPVAULT_DATABASE_PATH: /data/snapvault.json
      SNAPVAULT_STAGING_DIR: /staging
      SNAPVAULT_WEB_ORIGIN: http://localhost:8080
      SNAPVAULT_SECRET_KEY: ${SNAPVAULT_SECRET_KEY:-local-dev-secret}
      BETTERSTACK_SOURCE_TOKEN: ${BETTERSTACK_SOURCE_TOKEN:-}
```

### Verificação

```bash
# Verificar que a dependência foi instalada
grep "@logtail/pino" apps/api/package.json

# Verificar que o transport foi configurado
grep "logtail" apps/api/src/server.ts

# Verificar que o token está no config
grep "betterstackToken" apps/api/src/config.ts

# Build sem erros
cd apps/api && node_modules/.bin/tsc --noEmit
```

### Critério PASS

- [ ] `grep "@logtail/pino" apps/api/package.json` retorna resultado
- [ ] `grep "betterstackToken" apps/api/src/config.ts` retorna resultado
- [ ] `grep "logtail" apps/api/src/server.ts` retorna ao menos 2 linhas
- [ ] Quando `BETTERSTACK_SOURCE_TOKEN` está definido e a API sobe, os logs aparecem no painel do BetterStack em até 30 segundos
- [ ] Quando `BETTERSTACK_SOURCE_TOKEN` está vazio (dev local), a API sobe normalmente sem erro

---

## F0-03 — Capturar uncaughtException e unhandledRejection

**Status:** TODO
**Branch:** `fix/resiliencia`
**Dependências:** F0-02
**Esforço:** XS

### Contexto

O `server.ts` não registra handlers para `process.on("uncaughtException")` e `process.on("unhandledRejection")`. No Node.js, uma Promise rejeitada sem `.catch()` ou um erro síncrono fora de um `try/catch` mata o processo imediatamente sem log estruturado — o último item do log é o da linha anterior ao crash, não o erro em si.

Com o BetterStack integrado (F0-02), o `app.log.fatal()` já envia o log para o BetterStack antes do processo morrer — mas só se o handler existir. Sem o handler, o crash não gera nenhum log no BetterStack.

Estes handlers devem ser registrados **após** a inicialização do Fastify (para que `app.log` esteja disponível) e **antes** do `app.listen`.

### Arquivos a ler antes de executar

- `apps/api/src/server.ts` — localizar a última linha: `await app.listen({ host: config.host, port: config.port })`

### Mudança 1 — Adicionar handlers antes do listen

**Arquivo:** `apps/api/src/server.ts`

**Antes:**
```ts
await app.listen({ host: config.host, port: config.port });
```

**Depois:**
```ts
process.on("uncaughtException", (err) => {
  app.log.fatal({ err }, "uncaughtException — processo vai encerrar");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  app.log.fatal({ reason }, "unhandledRejection — processo vai encerrar");
  process.exit(1);
});

await app.listen({ host: config.host, port: config.port });
```

### Verificação

```bash
grep -n "uncaughtException\|unhandledRejection" apps/api/src/server.ts
```

### Critério PASS

- [ ] `grep uncaughtException apps/api/src/server.ts` retorna ao menos uma linha
- [ ] `grep unhandledRejection apps/api/src/server.ts` retorna ao menos uma linha
- [ ] Ambos os handlers chamam `process.exit(1)` após o log
- [ ] O código TypeScript compila sem erros

---

## F0-04 — Marcar runs presos como failed no boot

**Status:** TODO
**Branch:** `fix/resiliencia`
**Dependências:** F0-03
**Esforço:** S

### Contexto

Quando o processo `api` morre enquanto um backup está em execução (status `running` ou `queued`), o run fica nesse status para sempre no banco (`/data/snapvault.json`). Na próxima vez que a API sobe, o frontend exibe aquele run como "em execução" indefinidamente — mesmo que já tenham passado horas ou dias.

O `Store` usa arquivo JSON com escrita atômica (`.tmp` + `rename`), então não há corrupção de dados — o status do run fica errado, não o arquivo inteiro.

A correção é: ao iniciar o servidor, ler o banco e marcar como `failed` todos os runs com status `queued` ou `running`, com `errorCode: "PROCESS_CRASH"` e `finishedAt` com o timestamp atual. Esse log deve aparecer no BetterStack (já integrado em F0-02/F0-03) como `warn` para alertar sobre quantos runs foram afetados.

### Arquivos a ler antes de executar

- `apps/api/src/server.ts` — onde a lógica de boot será inserida, antes do `app.listen`
- `apps/api/src/store.ts` — método `store.update(fn)` que lê, executa `fn` e grava o banco
- `apps/api/src/types.ts` — tipo `BackupRun`: campos `status`, `finishedAt`, `errorMessage`, `errorCode`
- `apps/api/src/ids.ts` — função `now()` que retorna timestamp ISO string

### Mudança 1 — Limpeza de runs presos no boot

**Arquivo:** `apps/api/src/server.ts`

Localizar (após os handlers de processo de F0-03, antes do `app.listen`):

**Antes:**
```ts
process.on("uncaughtException", (err) => {
  app.log.fatal({ err }, "uncaughtException — processo vai encerrar");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  app.log.fatal({ reason }, "unhandledRejection — processo vai encerrar");
  process.exit(1);
});

await app.listen({ host: config.host, port: config.port });
```

**Depois:**
```ts
process.on("uncaughtException", (err) => {
  app.log.fatal({ err }, "uncaughtException — processo vai encerrar");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  app.log.fatal({ reason }, "unhandledRejection — processo vai encerrar");
  process.exit(1);
});

// Ao iniciar, marcar como failed qualquer run que ficou preso em queued/running
// (causado por crash do processo enquanto o backup estava em andamento)
const stuckCount = await store.update((db) => {
  const stuck = db.runs.filter((r) => r.status === "queued" || r.status === "running");
  for (const run of stuck) {
    run.status = "failed";
    run.finishedAt = now();
    run.errorCode = "PROCESS_CRASH";
    run.errorMessage = "Execucao interrompida por reinicio inesperado do processo";
  }
  return stuck.length;
});
if (stuckCount > 0) {
  app.log.warn({ stuckCount }, `boot: ${stuckCount} run(s) preso(s) marcado(s) como failed`);
}

await app.listen({ host: config.host, port: config.port });
```

### Verificação

```bash
grep -n "PROCESS_CRASH\|stuckCount" apps/api/src/server.ts
grep -n "^import.*now" apps/api/src/server.ts
```

### Critério PASS

- [ ] `grep PROCESS_CRASH apps/api/src/server.ts` retorna ao menos uma linha
- [ ] `grep "now()" apps/api/src/server.ts` confirma que `now` já está importado e é usado no boot
- [ ] O TypeScript compila sem erros
- [ ] Ao adicionar manualmente um run com `status: "running"` no JSON e reiniciar a API, o run aparece com `status: "failed"` após o boot

---

## F0-05 — Configurar uptime monitor e alertas no BetterStack

**Status:** TODO
**Branch:** `fix/resiliencia`
**Dependências:** F0-02
**Esforço:** XS

### Contexto

Com os logs chegando ao BetterStack (F0-02), o próximo passo é configurar o monitoramento externo de disponibilidade e os alertas. O BetterStack tem um módulo de **Uptime** separado do módulo de **Logs** — ambos estão incluídos no mesmo plano.

Esta task é manual (configuração no painel do BetterStack, sem mudança de código). Deve ser executada após F0-02 estar em PASS e o primeiro deploy com o token estar rodando em produção.

### Passos de configuração no painel do BetterStack

**1. Uptime Monitor — endpoint da API:**
- Acessar: **Uptime → Monitors → New Monitor**
- URL: `https://snapvault.77indicadores.com.br/health`
- Check interval: 1 minuto
- Regions: selecionar ao menos 2 (ex: São Paulo + Virginia)
- Nome: `SnapVault API`

**2. Uptime Monitor — frontend:**
- URL: `https://snapvault.77indicadores.com.br`
- Check interval: 5 minutos
- Nome: `SnapVault Web`

**3. Alerta de log — crash do processo:**
- Acessar: **Logs → Alerts → New Alert**
- Condition: `level = fatal`
- Nome: `SnapVault — crash de processo`
- Canal: email ou Slack (configurar em **Settings → Notification channels**)

**4. Alerta de log — run failed:**
- Condition: `message contains "PROCESS_CRASH"`
- Nome: `SnapVault — backup interrompido por crash`

### Verificação

Testar o alerta manualmente:
```bash
# Derrubar o container da API e verificar que o alerta chega em até 2 minutos
docker compose stop api
# aguardar notificação
docker compose start api
```

### Critério PASS

- [ ] Monitor `SnapVault API` aparece como **Up** no painel do BetterStack
- [ ] Monitor `SnapVault Web` aparece como **Up** no painel do BetterStack
- [ ] Ao parar o container da API por 2 minutos, um alerta de downtime chega no canal configurado
- [ ] Logs da API aparecem no BetterStack em tempo real durante o teste
