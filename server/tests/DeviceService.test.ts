import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "../src/errors/ApiError.js";
import type { DeviceStore } from "../src/repositories/DeviceRepository.js";
import { DeviceService } from "../src/services/DeviceService.js";
import type { DeviceRecord } from "../src/types/domain.js";

class MemoryDeviceRepository implements DeviceStore {
  public readonly records: DeviceRecord[] = [];
  public async findActiveByUser(userId: string): Promise<DeviceRecord | null> {
    return this.records.find((item) => item.userId === userId && item.isActive) ?? null;
  }
  public async findByHash(userId: string, hash: string): Promise<DeviceRecord | null> {
    return [...this.records].reverse().find((item) => item.userId === userId && item.deviceTokenHash === hash) ?? null;
  }
  public async create(userId: string, hash: string, name: string): Promise<DeviceRecord> {
    if (await this.findActiveByUser(userId)) throw new Error("unique active constraint");
    const record = this.record(userId, hash, name); this.records.push(record); return record;
  }
  public async touch(id: string): Promise<void> {
    const found = this.records.find((item) => item.id === id); if (found) found.lastSeenAt = new Date().toISOString();
  }
  public async revokeActive(userId: string): Promise<void> {
    this.records.filter((item) => item.userId === userId && item.isActive).forEach((item) => {
      item.isActive = false; item.revokedAt = new Date().toISOString();
    });
  }
  public async replaceActive(userId: string, hash: string, name: string): Promise<DeviceRecord> {
    await this.revokeActive(userId);
    const previous = await this.findByHash(userId, hash);
    if (previous) { previous.isActive = true; previous.revokedAt = null; previous.deviceName = name; return previous; }
    return this.create(userId, hash, name);
  }
  public async countActive(userId: string): Promise<number> {
    return this.records.filter((item) => item.userId === userId && item.isActive).length;
  }
  private record(userId: string, hash: string, name: string): DeviceRecord {
    const now = new Date().toISOString();
    return { id: crypto.randomUUID(), userId, deviceTokenHash: hash, deviceName: name,
      isActive: true, createdAt: now, lastSeenAt: now, revokedAt: null };
  }
}

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const userId = "user-1";

describe("DeviceService", () => {
  it("registerFirstDevice", async () => {
    const repository = new MemoryDeviceRepository(); const service = new DeviceService(repository, "test-secret");
    assert.equal((await service.registerFirstDevice(userId, firstId, "Celular")).status, "authorized");
    assert.equal(await repository.countActive(userId), 1);
  });
  it("sameDeviceAllowed", async () => {
    const repository = new MemoryDeviceRepository(); const service = new DeviceService(repository, "test-secret");
    await service.registerFirstDevice(userId, firstId, "Celular");
    assert.equal((await service.getState(userId, firstId)).status, "authorized");
  });
  it("secondDeviceRejected", async () => {
    const repository = new MemoryDeviceRepository(); const service = new DeviceService(repository, "test-secret");
    await service.registerFirstDevice(userId, firstId, "Celular");
    await assert.rejects(() => service.registerFirstDevice(userId, secondId, "Tablet"),
      (error: unknown) => error instanceof ApiError && error.code === "DEVICE_CONFLICT");
  });
  it("replaceDevice", async () => {
    const repository = new MemoryDeviceRepository(); const service = new DeviceService(repository, "test-secret");
    await service.registerFirstDevice(userId, firstId, "Celular");
    assert.equal((await service.replaceDevice(userId, secondId, "Tablet")).status, "authorized");
    assert.equal(await repository.countActive(userId), 1);
    assert.equal((await service.getState(userId, secondId)).status, "authorized");
  });
  it("revokedDeviceRejected", async () => {
    const repository = new MemoryDeviceRepository(); const service = new DeviceService(repository, "test-secret");
    await service.registerFirstDevice(userId, firstId, "Celular");
    await service.replaceDevice(userId, secondId, "Tablet");
    assert.equal((await service.getState(userId, firstId)).status, "revoked");
    await assert.rejects(() => service.assertActive(userId, firstId),
      (error: unknown) => error instanceof ApiError && error.code === "DEVICE_REVOKED");
  });
});
