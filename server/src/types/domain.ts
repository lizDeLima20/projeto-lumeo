export type LicenseStatus = "active" | "inactive";
export type DeviceBindingStatus = "unregistered" | "authorized" | "conflict" | "revoked";

export interface AuthenticatedUser { id: string; email: string; authenticatedAt?: string; }

export interface DeviceRecord {
  id: string;
  userId: string;
  deviceTokenHash: string;
  deviceName: string;
  isActive: boolean;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export interface DeviceState {
  status: DeviceBindingStatus;
  device?: Pick<DeviceRecord, "deviceName" | "lastSeenAt">;
}

export interface LicenseRecord {
  id: string;
  userId: string;
  status: LicenseStatus;
  purchasedAt: string | null;
}
