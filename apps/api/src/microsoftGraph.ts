import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { config } from "./config.js";

type GraphDriveTarget = {
  driveId: string;
  label: string;
};

export type MicrosoftDestinationConfig = {
  mode?: "graph" | "rclone";
  userPrincipalName?: string;
  driveId?: string;
  siteId?: string;
  hostname?: string;
  sitePath?: string;
};

export type MicrosoftCredentials = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

export async function getMicrosoftToken(credentials: MicrosoftCredentials = config.microsoft) {
  if (!credentials.clientId || !credentials.clientSecret || !credentials.tenantId) {
    throw new Error("Microsoft credentials are not configured");
  }
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials"
  });
  const response = await fetch(`https://login.microsoftonline.com/${credentials.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description ?? data.error ?? "Microsoft token request failed");
  return String(data.access_token);
}

export async function microsoftCredentialStatus(credentials: MicrosoftCredentials = config.microsoft) {
  const token = await getMicrosoftToken(credentials);
  return { ok: true, tokenType: "Bearer", tokenPresent: token.length > 0 };
}

export async function uploadToMicrosoftDrive(destinationConfig: MicrosoftDestinationConfig, basePath: string, localFile: string, remotePath: string, credentials?: MicrosoftCredentials) {
  const token = await getMicrosoftToken(credentials);
  const target = await resolveDrive(token, destinationConfig);
  const cleanBase = basePath.replace(/^\/+|\/+$/g, "");
  const cleanRemote = remotePath.replace(/^\/+|\/+$/g, "");
  const uploadPath = [cleanBase, cleanRemote, basename(localFile)].filter(Boolean).join("/");
  const bytes = await readFile(localFile);
  const response = await graphFetch(token, `https://graph.microsoft.com/v1.0/drives/${target.driveId}/root:/${encodePath(uploadPath)}:/content`, {
    method: "PUT",
    body: bytes
  });
  const data = await response.json();
  return { id: data.id as string, name: data.name as string, webUrl: data.webUrl as string, path: uploadPath, drive: target };
}

export async function deleteMicrosoftDrivePath(destinationConfig: MicrosoftDestinationConfig, path: string, credentials?: MicrosoftCredentials) {
  const token = await getMicrosoftToken(credentials);
  const target = await resolveDrive(token, destinationConfig);
  const cleanPath = path.replace(/^\/+|\/+$/g, "");
  const response = await fetch(`https://graph.microsoft.com/v1.0/drives/${target.driveId}/root:/${encodePath(cleanPath)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (response.status === 404) return { deleted: false, missing: true, path: cleanPath };
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error?.message ?? `Microsoft Graph lookup failed with ${response.status}`);
  }
  const item = await response.json();
  await graphFetch(token, `https://graph.microsoft.com/v1.0/drives/${target.driveId}/items/${item.id}`, { method: "DELETE" });
  return { deleted: true, missing: false, path: cleanPath };
}

export async function downloadMicrosoftDrivePath(destinationConfig: MicrosoftDestinationConfig, path: string, localFile: string, credentials?: MicrosoftCredentials) {
  const token = await getMicrosoftToken(credentials);
  const target = await resolveDrive(token, destinationConfig);
  const cleanPath = path.replace(/^\/+|\/+$/g, "");
  const response = await graphFetch(token, `https://graph.microsoft.com/v1.0/drives/${target.driveId}/root:/${encodePath(cleanPath)}:/content`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(localFile, bytes);
  return { path: cleanPath, localFile, sizeBytes: bytes.length, drive: target };
}

export async function testMicrosoftDestination(destinationConfig: MicrosoftDestinationConfig, basePath: string, credentials?: MicrosoftCredentials) {
  const token = await getMicrosoftToken(credentials);
  const target = await resolveDrive(token, destinationConfig);
  const testPath = `${basePath.replace(/^\/+|\/+$/g, "")}/connection-test-${Date.now()}.txt`;
  const contents = Buffer.from(`SnapVault Microsoft Graph connection test ${Date.now()}\n`);
  const put = await graphFetch(token, `https://graph.microsoft.com/v1.0/drives/${target.driveId}/root:/${encodePath(testPath)}:/content`, {
    method: "PUT",
    body: contents
  });
  const uploaded = await put.json();
  const download = await graphFetch(token, `https://graph.microsoft.com/v1.0/drives/${target.driveId}/items/${uploaded.id}/content`);
  const downloaded = Buffer.from(await download.arrayBuffer());
  const expected = createHash("sha256").update(contents).digest("hex");
  const actual = createHash("sha256").update(downloaded).digest("hex");
  if (expected !== actual) throw new Error("Microsoft Graph test download checksum mismatch");
  await graphFetch(token, `https://graph.microsoft.com/v1.0/drives/${target.driveId}/items/${uploaded.id}`, { method: "DELETE" });
  const quota = await getMicrosoftDriveQuota(target.driveId, credentials);
  return { status: "healthy", drive: target, uploadedName: uploaded.name, checked: ["token", "write", "download", "checksum", "delete", "quota"], quota: quota.quota };
}

export async function listMicrosoftUsers(credentials?: MicrosoftCredentials) {
  const token = await getMicrosoftToken(credentials);
  const res = await graphFetch(token, "https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName&$top=25");
  const data = await res.json();
  return { users: data.value ?? [] };
}

export async function listMicrosoftSites(credentials?: MicrosoftCredentials) {
  const token = await getMicrosoftToken(credentials);
  const res = await graphFetch(token, "https://graph.microsoft.com/v1.0/sites?search=*");
  const data = await res.json();
  return { sites: data.value ?? [] };
}

export async function listMicrosoftSiteDrives(siteId: string, credentials?: MicrosoftCredentials) {
  const token = await getMicrosoftToken(credentials);
  const res = await graphFetch(token, `https://graph.microsoft.com/v1.0/sites/${siteId}/drives`);
  const data = await res.json();
  return { drives: data.value ?? [] };
}

export async function getMicrosoftDriveQuota(driveId: string, credentials?: MicrosoftCredentials) {
  const token = await getMicrosoftToken(credentials);
  const res = await graphFetch(token, `https://graph.microsoft.com/v1.0/drives/${driveId}?$select=id,name,webUrl,quota`);
  const drive = await res.json();
  return { drive, quota: drive.quota ?? null };
}

async function resolveDrive(token: string, destinationConfig: MicrosoftDestinationConfig): Promise<GraphDriveTarget> {
  if (destinationConfig.driveId) return { driveId: destinationConfig.driveId, label: "configured-drive" };
  if (destinationConfig.userPrincipalName) {
    const res = await graphFetch(token, `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(destinationConfig.userPrincipalName)}/drive`);
    const drive = await res.json();
    return { driveId: drive.id, label: destinationConfig.userPrincipalName };
  }
  if (destinationConfig.siteId) {
    const res = await graphFetch(token, `https://graph.microsoft.com/v1.0/sites/${destinationConfig.siteId}/drive`);
    const drive = await res.json();
    return { driveId: drive.id, label: destinationConfig.siteId };
  }
  if (destinationConfig.hostname && destinationConfig.sitePath) {
    const res = await graphFetch(token, `https://graph.microsoft.com/v1.0/sites/${destinationConfig.hostname}:${destinationConfig.sitePath}`);
    const site = await res.json();
    const driveRes = await graphFetch(token, `https://graph.microsoft.com/v1.0/sites/${site.id}/drive`);
    const drive = await driveRes.json();
    return { driveId: drive.id, label: site.webUrl ?? site.id };
  }
  throw new Error("Microsoft destination requires driveId, userPrincipalName, siteId, or hostname/sitePath");
}

async function graphFetch(token: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/octet-stream" } : {}),
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error?.message ?? `Microsoft Graph request failed with ${response.status}`);
  }
  return response;
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}
