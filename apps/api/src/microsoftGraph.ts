import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { writeFile } from "node:fs/promises";
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

export async function getMicrosoftToken() {
  if (!config.microsoft.clientId || !config.microsoft.clientSecret || !config.microsoft.tenantId) {
    throw new Error("Microsoft credentials are not configured");
  }
  const body = new URLSearchParams({
    client_id: config.microsoft.clientId,
    client_secret: config.microsoft.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials"
  });
  const response = await fetch(`https://login.microsoftonline.com/${config.microsoft.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description ?? data.error ?? "Microsoft token request failed");
  return String(data.access_token);
}

export async function microsoftCredentialStatus() {
  const token = await getMicrosoftToken();
  return { ok: true, tokenType: "Bearer", tokenPresent: token.length > 0 };
}

export async function uploadToMicrosoftDrive(destinationConfig: MicrosoftDestinationConfig, basePath: string, localFile: string, remotePath: string) {
  const token = await getMicrosoftToken();
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

export async function deleteMicrosoftDrivePath(destinationConfig: MicrosoftDestinationConfig, path: string) {
  const token = await getMicrosoftToken();
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

export async function downloadMicrosoftDrivePath(destinationConfig: MicrosoftDestinationConfig, path: string, localFile: string) {
  const token = await getMicrosoftToken();
  const target = await resolveDrive(token, destinationConfig);
  const cleanPath = path.replace(/^\/+|\/+$/g, "");
  const response = await graphFetch(token, `https://graph.microsoft.com/v1.0/drives/${target.driveId}/root:/${encodePath(cleanPath)}:/content`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(localFile, bytes);
  return { path: cleanPath, localFile, sizeBytes: bytes.length, drive: target };
}

export async function testMicrosoftDestination(destinationConfig: MicrosoftDestinationConfig, basePath: string) {
  const token = await getMicrosoftToken();
  const target = await resolveDrive(token, destinationConfig);
  const testPath = `${basePath.replace(/^\/+|\/+$/g, "")}/connection-test-${Date.now()}.txt`;
  const put = await graphFetch(token, `https://graph.microsoft.com/v1.0/drives/${target.driveId}/root:/${encodePath(testPath)}:/content`, {
    method: "PUT",
    body: Buffer.from("SnapVault Microsoft Graph connection test\n")
  });
  const uploaded = await put.json();
  await graphFetch(token, `https://graph.microsoft.com/v1.0/drives/${target.driveId}/items/${uploaded.id}`, { method: "DELETE" });
  return { status: "healthy", drive: target, uploadedName: uploaded.name };
}

export async function listMicrosoftUsers() {
  const token = await getMicrosoftToken();
  const res = await graphFetch(token, "https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName&$top=25");
  const data = await res.json();
  return { users: data.value ?? [] };
}

export async function listMicrosoftSites() {
  const token = await getMicrosoftToken();
  const res = await graphFetch(token, "https://graph.microsoft.com/v1.0/sites?search=*");
  const data = await res.json();
  return { sites: data.value ?? [] };
}

export async function listMicrosoftSiteDrives(siteId: string) {
  const token = await getMicrosoftToken();
  const res = await graphFetch(token, `https://graph.microsoft.com/v1.0/sites/${siteId}/drives`);
  const data = await res.json();
  return { drives: data.value ?? [] };
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
