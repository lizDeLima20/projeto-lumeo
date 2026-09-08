import type { StorageAdapter } from "../services/StorageService";

export type LicenseState = "UNKNOWN" | "TRIAL" | "ACTIVE" | "GRACE" | "EXPIRED" | "REVOKED" | "OFFLINE_GRACE";
export interface CachedLicense { state: LicenseState; validatedAt: string; expiresAt?: string; }

export class LicenseRepository {
  private static readonly KEY = "license-cache";
  public constructor(private readonly storage: StorageAdapter) {}
  public load(): Promise<CachedLicense | null> { return this.storage.load<CachedLicense>(LicenseRepository.KEY); }
  public save(license: CachedLicense): Promise<void> { return this.storage.save(LicenseRepository.KEY, license); }
}

export class LicenseManager {
  public constructor(private readonly repository: LicenseRepository, private readonly offlineGraceMs = 1000 * 60 * 60 * 24 * 7) {}

  public async cacheOnlineState(state: LicenseState): Promise<void> {
    await this.repository.save({ state, validatedAt: new Date().toISOString() });
  }

  public async stateWhenOffline(now = Date.now()): Promise<LicenseState> {
    const cached = await this.repository.load();
    if (!cached || cached.state !== "ACTIVE") return "EXPIRED";
    return now - new Date(cached.validatedAt).getTime() <= this.offlineGraceMs ? "OFFLINE_GRACE" : "EXPIRED";
  }

  public canFrontendActivateLicense(): false { return false; }
}
