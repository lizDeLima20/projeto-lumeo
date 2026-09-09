import { readOneDriveConfig, type OneDriveConfig } from "./OneDriveConfig";
import { OneDriveAuthManager } from "./OneDriveAuthManager";
import { OneDriveGraphClient } from "./OneDriveGraphClient";
import { OneDriveSourceRepository } from "./OneDriveSourceRepository";
import { OneDriveFolderResolver } from "./OneDriveFolderResolver";
import { OneDriveBrowserService } from "./OneDriveBrowserService";
import { OneDriveDownloadService } from "./OneDriveDownloadService";
import type { StorageAdapter } from "../services/StorageService";
export class OneDriveConnections {
  public readonly auth: OneDriveAuthManager;
  public readonly sources: OneDriveSourceRepository;
  public readonly folders: OneDriveFolderResolver;
  public readonly browser: OneDriveBrowserService;
  public readonly downloads: OneDriveDownloadService;
  public constructor(storage: StorageAdapter, userId: string, public readonly config: OneDriveConfig = readOneDriveConfig()) {
    this.auth = new OneDriveAuthManager(config);
    const graph = new OneDriveGraphClient(this.auth);
    this.sources = new OneDriveSourceRepository(storage, userId);
    this.folders = new OneDriveFolderResolver(graph);
    this.browser = new OneDriveBrowserService(graph);
    this.downloads = new OneDriveDownloadService(graph);
  }
}
