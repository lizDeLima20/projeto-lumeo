import type { CatalogDownloadLink } from "./CatalogService";
import { CapacitorNativeBookDownloadBridge, isNativeAndroidBookDownloadRuntime } from "./NativeBookDownload";

export type CatalogDownloadProgress = (downloadedBytes: number, totalBytes: number | null) => void;

/** A native result becomes a File only inside the Android WebView, then uses
 * the same ImportManager pipeline as every other Lumeo book. */
export type CatalogDownloadReceipt =
  | { readonly kind: "browser-download" }
  | { readonly kind: "native-file"; readonly file: File };

/** Boundary between catalogue UI and the platform that receives a book. */
export interface CatalogDownloadService {
  readonly target: "browser-download" | "android-private-storage";
  download(link: CatalogDownloadLink, onProgress?: CatalogDownloadProgress, signal?: AbortSignal): Promise<CatalogDownloadReceipt>;
}

/** Web/Desktop retains its existing normal browser-download behaviour. */
export class WebCatalogDownloadService implements CatalogDownloadService {
  public readonly target = "browser-download" as const;

  public async download(link: CatalogDownloadLink, _onProgress?: CatalogDownloadProgress, signal?: AbortSignal): Promise<CatalogDownloadReceipt> {
    if (signal?.aborted) throw new DOMException("Download cancelado.", "AbortError");
    if (typeof document === "undefined") throw new Error("O download do navegador não está disponível neste ambiente.");
    const anchor = document.createElement("a");
    anchor.href = link.downloadUrl;
    anchor.download = link.expectedFilename;
    anchor.rel = "noreferrer";
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    return { kind: "browser-download" };
  }
}

export interface AndroidCatalogDownloadBridge {
  downloadToPrivateStorage(link: CatalogDownloadLink, onProgress?: CatalogDownloadProgress, signal?: AbortSignal): Promise<File>;
}

export class AndroidCatalogDownloadService implements CatalogDownloadService {
  public readonly target = "android-private-storage" as const;
  public constructor(private readonly bridge: AndroidCatalogDownloadBridge) {}
  public async download(link: CatalogDownloadLink, onProgress?: CatalogDownloadProgress, signal?: AbortSignal): Promise<CatalogDownloadReceipt> {
    return { kind: "native-file", file: await this.bridge.downloadToPrivateStorage(link, onProgress, signal) };
  }
}

/** Keeps platform selection in one place; views stay platform agnostic. */
export class HybridCatalogDownloadService implements CatalogDownloadService {
  private readonly android: CatalogDownloadService | null;
  public constructor(private readonly web: CatalogDownloadService = new WebCatalogDownloadService(), android?: CatalogDownloadService | null) {
    this.android = android === undefined ? HybridCatalogDownloadService.androidService() : android;
  }
  public get target(): CatalogDownloadService["target"] { return this.android?.target ?? this.web.target; }
  public download(link: CatalogDownloadLink, onProgress?: CatalogDownloadProgress, signal?: AbortSignal): Promise<CatalogDownloadReceipt> {
    return (this.android ?? this.web).download(link, onProgress, signal);
  }
  private static androidService(): CatalogDownloadService | null {
    if (!isNativeAndroidBookDownloadRuntime()) return null;
    // Android must never silently fall back to a WebView download. A registered
    // native plugin is authoritative even if Capacitor's generic marker is
    // initialised late by this WebView.
    return new AndroidCatalogDownloadService(new CapacitorNativeBookDownloadBridge());
  }
}
