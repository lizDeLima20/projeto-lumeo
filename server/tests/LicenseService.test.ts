import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Config } from "../src/config/Config.js";
import { MemoryLicenseRepository } from "../src/repositories/MemoryRepositories.js";
import type { LicenseStore } from "../src/repositories/LicenseRepository.js";
import { LicenseService } from "../src/services/LicenseService.js";
import type { LicenseRecord } from "../src/types/domain.js";
import { ApiError } from "../src/errors/ApiError.js";

describe("LicenseService temporary development activation", () => {
  it("requires an explicit environment flag even in development", async () => {
    const service = new LicenseService(new MemoryLicenseRepository(), Config.fromEnvironment({ NODE_ENV: "development", AUTO_ACTIVATE_DEV_LICENSE: "false" }));
    await assert.rejects(() => service.getForUser("reader"), (error: unknown) => error instanceof ApiError && error.code === "LICENSE_REQUIRED");
  });
  it("activates a missing or inactive test account when explicitly enabled", async () => {
    const store = new InactiveStore(); const service = new LicenseService(store, Config.fromEnvironment({ NODE_ENV: "production", AUTO_ACTIVATE_DEV_LICENSE: "true" }));
    const license = await service.getForUser("reader");
    assert.equal(license.status, "active"); assert.equal(store.activated, 1);
  });
  it("does not rewrite an already active paid license", async () => {
    const store = new ActiveStore(); const service = new LicenseService(store, Config.fromEnvironment({ NODE_ENV: "production", AUTO_ACTIVATE_DEV_LICENSE: "true" }));
    assert.equal((await service.getForUser("reader")).status, "active"); assert.equal(store.activated, 0);
  });
});

class InactiveStore implements LicenseStore {
  public activated = 0;
  public async findByUser(userId: string): Promise<LicenseRecord | null> { return { id: "license", userId, status: "inactive", purchasedAt: null }; }
  public async createDevelopmentLicense(userId: string): Promise<LicenseRecord> { this.activated++; return { id: "license", userId, status: "active", purchasedAt: null }; }
}
class ActiveStore extends InactiveStore {
  public override async findByUser(userId: string): Promise<LicenseRecord | null> { return { id: "license", userId, status: "active", purchasedAt: "2026-09-12" }; }
}
