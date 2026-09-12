import type { ServerConfig } from "../config/Config.js";
import { ApiError } from "../errors/ApiError.js";
import type { LicenseStore } from "../repositories/LicenseRepository.js";
import type { LicenseRecord } from "../types/domain.js";

export class LicenseService {
  public constructor(private readonly repository: LicenseStore, private readonly config: ServerConfig) {}
  public async getForUser(userId: string): Promise<LicenseRecord> {
    const existing = await this.repository.findByUser(userId);
    if (existing?.status === "active") return existing;
    // Only an explicit server environment flag can activate temporary test
    // licences. The browser can neither set this flag nor activate itself.
    if (this.config.autoActivateDevLicense) return this.repository.createDevelopmentLicense(userId);
    throw new ApiError(403, "LICENSE_REQUIRED", "Esta conta não possui uma licença ativa.");
  }
}
