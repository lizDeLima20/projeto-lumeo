export interface OneDriveConfig { enabled: boolean; clientId: string; tenantId: string; redirectUri: string; }
export function readOneDriveConfig(env: ImportMetaEnv = import.meta.env): OneDriveConfig {
  const tenant = env.VITE_MICROSOFT_TENANT_ID || "common";
  return {
    enabled: env.VITE_ONEDRIVE_ENABLED === "true",
    clientId: env.VITE_MICROSOFT_CLIENT_ID || "",
    tenantId: /^[a-zA-Z0-9.-]+$/.test(tenant) ? tenant : "common",
    redirectUri: `${globalThis.location?.origin ?? ""}/onedrive-auth.html`,
  };
}
