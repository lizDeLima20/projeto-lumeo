import { IndexedDbService } from "../services/IndexedDbService";

export interface AppVersionInfo {
  appVersion: string;
  serviceWorkerVersion: string;
  schemaVersion: number;
  minimumCompatibleSchemaVersion: number;
}

export class AppVersionManager {
  public static readonly APP_VERSION = "0.1.0";
  public static readonly SERVICE_WORKER_VERSION = "v13";
  public static readonly MINIMUM_COMPATIBLE_SCHEMA_VERSION = 8;

  public info(): AppVersionInfo {
    return {
      appVersion: AppVersionManager.APP_VERSION,
      serviceWorkerVersion: AppVersionManager.SERVICE_WORKER_VERSION,
      schemaVersion: IndexedDbService.SCHEMA_VERSION,
      minimumCompatibleSchemaVersion: AppVersionManager.MINIMUM_COMPATIBLE_SCHEMA_VERSION,
    };
  }
}
