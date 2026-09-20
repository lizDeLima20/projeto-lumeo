import { Capacitor, registerPlugin, type Plugin, type PluginListenerHandle } from "@capacitor/core";
import type { CatalogDownloadLink } from "./CatalogService";
import type { AndroidCatalogDownloadBridge, CatalogDownloadProgress } from "./CatalogDownloadService";

interface NativeDownloadOptions { bookId: string; url: string; expectedSize?: number; sha256?: string; }
interface NativeDownloadResult { bookId: string; uri: string; size: number; sha256: string | null; mimeType: string; existing: boolean; }
interface NativeDownloadProgress { bookId: string; bytesDownloaded: number; totalBytes: number | null; percentage: number | null; }
interface NativeBookDownloadPlugin extends Plugin {
  downloadBook(options: NativeDownloadOptions): Promise<NativeDownloadResult>;
  cancelDownload(options: { bookId: string }): Promise<{ cancelled: boolean }>;
  addListener(eventName: "bookDownloadProgress", listener: (event: NativeDownloadProgress) => void): Promise<PluginListenerHandle>;
  logDiagnostic(options: { stage: string; bookId?: string; errorCode?: string; exceptionClass?: string }): Promise<void>;
}

const NativeBookDownload = registerPlugin<NativeBookDownloadPlugin>("NativeBookDownload");

/**
 * Capacitor's generic platform marker can be initialised late in a WebView.
 * The registered native plugin is the authoritative signal for this specific
 * bridge: it cannot exist in the ordinary browser build.
 */
export function isNativeAndroidBookDownloadRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const pluginAvailable = Capacitor.isPluginAvailable("NativeBookDownload");
  return (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") || pluginAvailable;
}

/** Native-only bridge: no Drive URL or Android conditional leaks into views. */
export class CapacitorNativeBookDownloadBridge implements AndroidCatalogDownloadBridge {
  public async downloadToPrivateStorage(link: CatalogDownloadLink, onProgress?: CatalogDownloadProgress, signal?: AbortSignal): Promise<File> {
    const native = Capacitor.isNativePlatform();
    const platform = Capacitor.getPlatform();
    const pluginAvailable = Capacitor.isPluginAvailable("NativeBookDownload");
    this.log("PLATFORM_DETECTED", { native, platform });
    this.log("PLUGIN_AVAILABLE", { available: pluginAvailable });
    if (!isNativeAndroidBookDownloadRuntime()) throw new NativeBookDownloadError("NATIVE_DOWNLOAD_UNAVAILABLE", "Download nativo indisponível neste dispositivo.");
    if (!pluginAvailable) throw new NativeBookDownloadError("NATIVE_PLUGIN_UNAVAILABLE", "O componente de download do Android não está disponível.");
    let progressListener: PluginListenerHandle | null = null;
    const cancel = (): void => { void NativeBookDownload.cancelDownload({ bookId: link.bookId }); };
    try {
      progressListener = await NativeBookDownload.addListener("bookDownloadProgress", event => {
        if (event.bookId === link.bookId) onProgress?.(event.bytesDownloaded, event.totalBytes);
      });
      if (signal?.aborted) { cancel(); throw new DOMException("Download cancelado.", "AbortError"); }
      signal?.addEventListener("abort", cancel, { once: true });
      const urls = [...new Set([link.downloadUrl, ...(link.downloadUrls ?? [])])];
      let lastError: unknown;
      for (const url of urls) {
        try {
          this.log("BFF_URL_OK", { bookId: link.bookId, sourceHost: new URL(url).host });
          this.log("DOWNLOAD_URL_RECEIVED", { bookId: link.bookId, host: new URL(url).host });
          this.log("PLUGIN_CALLED", { bookId: link.bookId });
          const result = await NativeBookDownload.downloadBook({ bookId: link.bookId, url, expectedSize: link.fileSize ?? undefined, sha256: link.sha256 ?? undefined });
          const file = await this.asImportFile(result, link);
          this.log("FILE_SAVED", { bookId: link.bookId, bytes: result.size, existing: result.existing });
          return file;
        } catch (error) {
          lastError = error;
          const code = NativeBookDownloadError.from(error).code;
          this.log("DOWNLOAD_FAILED", { bookId: link.bookId, stage: "NATIVE_PLUGIN", errorCode: code, exceptionClass: error instanceof Error ? error.constructor.name : "Unknown" });
          if (this.mustStopAfterNativeFailure(code)) throw error;
          this.log("ALTERNATIVE_URL_RETRY", { bookId: link.bookId, errorCode: code });
        }
      }
      throw lastError;
    } catch (error) {
      throw NativeBookDownloadError.from(error);
    } finally {
      signal?.removeEventListener("abort", cancel);
      await progressListener?.remove();
    }
  }

  private async asImportFile(result: NativeDownloadResult, link: CatalogDownloadLink): Promise<File> {
    const localUrl = Capacitor.convertFileSrc(result.uri);
    this.log("PRIVATE_FILE_ACCESS_STARTED", { bookId: result.bookId, scheme: new URL(localUrl).protocol });
    let response: Response;
    try { response = await fetch(localUrl); }
    catch { throw new NativeBookDownloadError("NATIVE_FILE_UNREADABLE", "O arquivo salvo não pôde ser preparado para a biblioteca."); }
    if (!response.ok) throw new NativeBookDownloadError("NATIVE_FILE_UNREADABLE", "O arquivo salvo não pôde ser preparado para a biblioteca.");
    const blob = await response.blob();
    if (blob.size <= 0 || (result.size > 0 && blob.size !== result.size)) throw new NativeBookDownloadError("NATIVE_FILE_INCOMPLETE", "O arquivo salvo está incompleto.");
    this.log("PRIVATE_FILE_ACCESS_OK", { bookId: result.bookId, bytes: blob.size });
    this.log("FILE_VALIDATED", { bookId: result.bookId, bytes: blob.size, mimeType: result.mimeType });
    return new File([blob], link.expectedFilename, { type: result.mimeType });
  }
  private mustStopAfterNativeFailure(code: string): boolean {
    // Errors caused by the current public Drive URL (HTML interstitials, 403s,
    // 404s, timeouts or invalid downloaded bytes) should try the next BFF
    // fallback URL. Local/device failures cannot be fixed by another URL.
    return [
      "DOWNLOAD_CANCELLED",
      "DOWNLOAD_REQUEST_INVALID",
      "DOWNLOAD_STORAGE_UNAVAILABLE",
      "NO_SPACE",
      "FILE_MOVE_FAILED",
      "NATIVE_FILE_UNREADABLE",
      "NATIVE_FILE_INCOMPLETE",
    ].includes(code) || code.startsWith("NATIVE_");
  }
  private log(stage: string, details: Record<string, unknown>): void { reportNativeDownloadDiagnostic(stage, details); }
}

/** Sends only bounded technical categories to Logcat; book content, URLs,
 * tokens and exception messages are deliberately excluded. */
export function reportNativeDownloadDiagnostic(stage: string, details: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ event: "LUMEO_NATIVE_DOWNLOAD", stage, ...details }));
  if (!isNativeAndroidBookDownloadRuntime() || !Capacitor.isPluginAvailable("NativeBookDownload")) return;
  const string = (key: string): string | undefined => typeof details[key] === "string" ? details[key] : undefined;
  void NativeBookDownload.logDiagnostic({ stage, bookId: string("bookId"), errorCode: string("errorCode"), exceptionClass: string("exceptionClass") }).catch(() => undefined);
}

export class NativeBookDownloadError extends Error {
  public constructor(public readonly code: string, message: string) { super(message); }
  public static from(error: unknown): NativeBookDownloadError {
    if (error instanceof NativeBookDownloadError) return error;
    if (error instanceof DOMException && error.name === "AbortError") return new NativeBookDownloadError("DOWNLOAD_CANCELLED", error.message);
    if (typeof error === "object" && error !== null && "code" in error && "message" in error && typeof error.code === "string" && typeof error.message === "string") return new NativeBookDownloadError(error.code, error.message);
    return new NativeBookDownloadError("DOWNLOAD_FAILED", "Não foi possível baixar o livro.");
  }
}
