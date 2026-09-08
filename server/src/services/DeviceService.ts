import { createHmac } from "node:crypto";
import { ApiError } from "../errors/ApiError.js";
import type { DeviceStore } from "../repositories/DeviceRepository.js";
import type { DeviceState } from "../types/domain.js";

export class DeviceService {
  public constructor(private readonly repository: DeviceStore, private readonly hashSecret: string) {}
  public async getState(userId: string, installationId: string): Promise<DeviceState> {
    const matching = await this.repository.findByHash(userId, this.hash(installationId));
    if (matching?.isActive) {
      await this.repository.touch(matching.id);
      return { status: "authorized", device: this.publicDevice(matching) };
    }
    if (matching) return { status: "revoked" };
    const active = await this.repository.findActiveByUser(userId);
    if (active) return { status: "conflict", device: this.publicDevice(active) };
    return { status: "unregistered" };
  }
  public async registerFirstDevice(userId: string, installationId: string, deviceName: string): Promise<DeviceState> {
    const current = await this.getState(userId, installationId);
    if (current.status === "authorized") return current;
    if (current.status === "conflict") throw new ApiError(409, "DEVICE_CONFLICT", "A conta já está vinculada a outro dispositivo.");
    if (current.status === "revoked") throw new ApiError(403, "DEVICE_REVOKED", "Este dispositivo foi revogado.");
    const created = await this.repository.create(userId, this.hash(installationId), this.cleanName(deviceName));
    return { status: "authorized", device: this.publicDevice(created) };
  }
  public async replaceDevice(userId: string, installationId: string, deviceName: string): Promise<DeviceState> {
    const created = await this.repository.replaceActive(userId, this.hash(installationId), this.cleanName(deviceName));
    if (await this.repository.countActive(userId) !== 1) throw new ApiError(500, "DEVICE_INVARIANT_FAILED", "Falha na regra de dispositivo único.");
    return { status: "authorized", device: this.publicDevice(created) };
  }
  public async revokeCurrent(userId: string, installationId: string): Promise<void> {
    const matching = await this.repository.findByHash(userId, this.hash(installationId));
    if (!matching?.isActive) throw new ApiError(403, "DEVICE_REVOKED", "Este dispositivo não está ativo.");
    await this.repository.revokeActive(userId);
  }
  public async assertActive(userId: string, installationId: string): Promise<void> {
    const state = await this.getState(userId, installationId);
    if (state.status !== "authorized") {
      throw new ApiError(403, state.status === "revoked" ? "DEVICE_REVOKED" : "DEVICE_NOT_AUTHORIZED", "Dispositivo não autorizado.");
    }
  }
  private hash(installationId: string): string {
    if (!this.hashSecret) throw new ApiError(503, "DEVICE_HASH_NOT_CONFIGURED", "Hash de dispositivo não configurado.");
    if (!/^[0-9a-f-]{36}$/i.test(installationId)) throw new ApiError(400, "INVALID_INSTALLATION_ID", "Identificador inválido.");
    return createHmac("sha256", this.hashSecret).update(installationId).digest("hex");
  }
  private cleanName(name: string): string {
    const clean = name.trim().slice(0, 80);
    if (!clean) throw new ApiError(400, "INVALID_DEVICE_NAME", "Nome do dispositivo inválido.");
    return clean;
  }
  private publicDevice(device: { deviceName: string; lastSeenAt: string }): { deviceName: string; lastSeenAt: string } {
    return { deviceName: device.deviceName, lastSeenAt: device.lastSeenAt };
  }
}
