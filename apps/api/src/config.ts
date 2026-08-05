import { resolve } from "node:path";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  stagingDir: process.env.SNAPVAULT_STAGING_DIR ?? resolve(process.cwd(), "../../staging"),
  cookieSecret: process.env.SNAPVAULT_SECRET_KEY ?? "dev-secret-change-me",
  webOrigin: process.env.SNAPVAULT_WEB_ORIGIN ?? "http://localhost:5173",
  betterstackToken: process.env.BETTERSTACK_SOURCE_TOKEN ?? "",
  microsoft: {
    clientId: process.env.MS_CLIENT_ID ?? "",
    clientSecret: process.env.MS_CLIENT_SECRET ?? "",
    tenantId: process.env.MS_TENANT_ID ?? ""
  },
  pg: {
    host:     process.env.POSTGRES_HOST     ?? "postgres",
    port:     Number(process.env.POSTGRES_PORT ?? 5432),
    user:     process.env.POSTGRES_USER     ?? "postgres",
    password: process.env.POSTGRES_PASSWORD ?? "postgres",
    database: process.env.SNAPVAULT_DB      ?? "snapvault",
  }
};
