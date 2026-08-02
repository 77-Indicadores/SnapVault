import { resolve } from "node:path";

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
