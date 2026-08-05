// Helper functions kept for use in server.ts.
// The Store class and JSON-file persistence have been replaced by PostgreSQL (db.ts).

import type { Database } from "./types.js";

export const publicUser = (user: Database["users"][number]) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role
});

export const withoutSecrets = <T extends { secrets?: Record<string, string> }>(entity: T) => {
  const { secrets, ...rest } = entity;
  return rest;
};

export const publicMicrosoftIntegration = (microsoft: any) => {
  if (!microsoft) {
    return { configured: false, id: "", name: "", tenantId: "", clientId: "", clientSecretSet: false, status: "untested", lastTestedAt: null };
  }
  return {
    configured: true,
    id: microsoft.id,
    name: microsoft.name,
    tenantId: microsoft.tenantId,
    clientId: microsoft.clientId,
    clientSecretSet: Boolean(microsoft.encryptedClientSecret),
    status: microsoft.status,
    lastTestedAt: microsoft.lastTestedAt,
    updatedAt: microsoft.updatedAt
  };
};

export const publicMicrosoftConfig = (settings: Database["settings"]) => publicMicrosoftIntegration(settings?.microsoft);
