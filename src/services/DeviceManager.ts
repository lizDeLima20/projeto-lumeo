import type { AppState, DeviceStatus } from "../core/AppState";
import { ApiClient, ApiError } from "./ApiClient";
import { StorageService } from "./StorageService";

export interface DeviceInfo { deviceName: string; lastSeenAt: string; }
export interface DeviceResponse { status: "unregistered" | DeviceStatus; device?: DeviceInfo; }

export class DeviceManager {
  private static readonly INSTALLATION_KEY = "installation-id";
  public constructor(private readonly api: ApiClient, private readonly storage: StorageService, private readonly state: AppState) {}

  public async initialize(): Promise<void> {
    let id = await this.storage.load<string>(DeviceManager.INSTALLATION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      await this.storage.save(DeviceManager.INSTALLATION_KEY, id);
    }
    this.api.setInstallationId(id);
  }
  public async ensureAuthorized(): Promise<DeviceResponse> {
    if (!this.state.currentUser || !this.isAuthenticated()) {
      throw new ApiError(401, "AUTH_REQUIRED", "Autenticação necessária.");
    }
    let response = await this.api.get<DeviceResponse>("/device");
    if (response.status === "unregistered") {
      response = await this.api.post<DeviceResponse>("/device/register", { deviceName: this.deviceName() });
    }
    this.update(response);
    return response;
  }
  public async replace(): Promise<void> {
    this.update(await this.api.post<DeviceResponse>("/device/replace", { deviceName: this.deviceName() }));
  }
  public async revoke(): Promise<void> {
    await this.api.post("/device/revoke", {});
    this.state.deviceStatus = "revoked";
    this.state.notify();
  }
  private update(response: DeviceResponse): void {
    this.state.deviceStatus = response.status === "unregistered" ? "unknown" : response.status;
    this.state.conflictingDevice = response.device ?? null;
    this.state.notify();
  }
  private deviceName(): string {
    const platform = navigator.platform;
    return `Lumeo em ${platform || "navegador"}`;
  }
  private isAuthenticated(): boolean {
    return this.state.authStatus === "authenticated" || this.state.authStatus === "AUTHENTICATED" || this.state.authStatus === "OFFLINE_AUTHENTICATED";
  }
}
