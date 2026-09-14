import type { CatalogDownloadLink } from "./CatalogService";

/**
 * Boundary between the catalogue UI and the platform that receives the book.
 * The web implementation deliberately starts a normal browser download: Drive
 * does not expose a CORS-readable public media response for the PWA.
 */
export interface CatalogDownloadService {
  readonly target: "browser-download" | "android-private-storage";
  download(link: CatalogDownloadLink): Promise<void>;
}

/** Web/Desktop: the browser owns its Downloads folder and the reader selects
 * the finished file explicitly before ImportManager persists it locally. */
export class WebCatalogDownloadService implements CatalogDownloadService {
  public readonly target = "browser-download" as const;

  public async download(link: CatalogDownloadLink): Promise<void> {
    if (typeof document === "undefined") throw new Error("O download do navegador não está disponível neste ambiente.");
    const anchor = document.createElement("a");
    anchor.href = link.downloadUrl;
    anchor.download = link.expectedFilename;
    anchor.rel = "noreferrer";
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }
}

/**
 * Contract reserved for the future Capacitor plugin. It intentionally has no
 * Android implementation in the PWA: a native plugin will download directly
 * from Drive into app-private storage, never through the BFF.
 */
export interface AndroidCatalogDownloadBridge {
  downloadToPrivateStorage(link: CatalogDownloadLink): Promise<void>;
}

export class AndroidCatalogDownloadService implements CatalogDownloadService {
  public readonly target = "android-private-storage" as const;
  public constructor(private readonly bridge: AndroidCatalogDownloadBridge) {}
  public download(link: CatalogDownloadLink): Promise<void> { return this.bridge.downloadToPrivateStorage(link); }
}

/** Keeps platform selection in one place while the PWA remains web-first. */
export class HybridCatalogDownloadService implements CatalogDownloadService {
  public constructor(private readonly web: CatalogDownloadService = new WebCatalogDownloadService(), private readonly android: CatalogDownloadService | null = null) {}
  public get target(): CatalogDownloadService["target"] { return this.android?.target ?? this.web.target; }
  public download(link: CatalogDownloadLink): Promise<void> { return (this.android ?? this.web).download(link); }
}
