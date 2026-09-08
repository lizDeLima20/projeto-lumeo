import { randomUUID } from "node:crypto";
import type { DeviceStore } from "./DeviceRepository.js";
import type { LicenseStore } from "./LicenseRepository.js";
import type { ProfileStore } from "./ProfileRepository.js";
import type { DeviceRecord, LicenseRecord } from "../types/domain.js";

export class MemoryDeviceRepository implements DeviceStore {
  private readonly records: DeviceRecord[] = [];
  public async findActiveByUser(userId: string): Promise<DeviceRecord | null> { return this.records.find((item) => item.userId === userId && item.isActive) ?? null; }
  public async findByHash(userId: string, hash: string): Promise<DeviceRecord | null> { return [...this.records].reverse().find((item) => item.userId === userId && item.deviceTokenHash === hash) ?? null; }
  public async create(userId: string, hash: string, name: string): Promise<DeviceRecord> {
    if (await this.findActiveByUser(userId)) throw new Error("Active device already exists");
    const record = this.make(userId, hash, name); this.records.push(record); return record;
  }
  public async touch(id: string): Promise<void> { const item = this.records.find((record) => record.id === id); if (item) item.lastSeenAt = new Date().toISOString(); }
  public async revokeActive(userId: string): Promise<void> { this.records.filter((item) => item.userId === userId && item.isActive).forEach((item) => { item.isActive = false; item.revokedAt = new Date().toISOString(); }); }
  public async replaceActive(userId: string, hash: string, name: string): Promise<DeviceRecord> {
    await this.revokeActive(userId); const previous = await this.findByHash(userId, hash);
    if (previous) { previous.isActive = true; previous.revokedAt = null; previous.deviceName = name; return previous; }
    return this.create(userId, hash, name);
  }
  public async countActive(userId: string): Promise<number> { return this.records.filter((item) => item.userId === userId && item.isActive).length; }
  private make(userId: string, hash: string, deviceName: string): DeviceRecord {
    const now = new Date().toISOString();
    return { id: randomUUID(), userId, deviceTokenHash: hash, deviceName, isActive: true, createdAt: now, lastSeenAt: now, revokedAt: null };
  }
}

export class MemoryLicenseRepository implements LicenseStore {
  private readonly records = new Map<string, LicenseRecord>();
  public async findByUser(userId: string): Promise<LicenseRecord | null> { return this.records.get(userId) ?? null; }
  public async createDevelopmentLicense(userId: string): Promise<LicenseRecord> {
    const license: LicenseRecord = { id: randomUUID(), userId, status: "active", purchasedAt: new Date().toISOString() };
    this.records.set(userId, license); return license;
  }
}

export class MemoryProfileRepository implements ProfileStore {
  private readonly profiles = new Map<string, string>();
  public async ensure(userId: string, email: string): Promise<void> { this.profiles.set(userId, email); }
}
