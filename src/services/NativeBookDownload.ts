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
}

const NativeBookDownload = registerPlugin<NativeBookDownloadPlugin>("NativeBookDownload");

/** Native-only bridge: no Drive URL or Android conditional leaks into views. */
export class CapacitorNativeBookDownloadBridge implements AndroidCatalogDownloadBridge {
  public async downloadToPrivateStorage(link: CatalogDownloadLink, onProgress?: CatalogDownloadProgress, signal?: AbortSignal): Promise<File> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") throw new NativeBookDownloadError("NATIVE_DOWNLOAD_UNAVAILABLE", "Download nativo indisponível neste dispositivo.");
    let progressListener: PluginListenerHandle | null = null;
    const cancel = (): void => { void NativeBookDownload.cancelDownload({ bookId: link.bookId }); };
    try {
      progressListener = await NativeBookDownload.addListener("bookDownloadProgress", event => {
        if (event.bookId === link.bookId) onProgress?.(event.bytesDownloaded, event.totalBytes);
      });
      if (signal?.aborted) { cancel(); throw new DOMException("Download cancelado.", "AbortError"); }
      signal?.addEventListener("abort", cancel, { once: true });
      const result = await NativeBookDownload.downloadBook({ bookId: link.bookId, url: link.downloadUrl, expectedSize: link.fileSize ?? undefined, sha256: link.sha256 ?? undefined });
      return this.asImportFile(result, link);
    } catch (error) {
      throw NativeBookDownloadError.from(error);
    } finally {
      signal?.removeEventListener("abort", cancel);
      await progressListener?.remove();
    }
  }

  private async asImportFile(result: NativeDownloadResult, link: CatalogDownloadLink): Promise<File> {
    const response = await fetch(Capacitor.convertFileSrc(result.uri));
    if (!response.ok) throw new NativeBookDownloadError("NATIVE_FILE_UNREADABLE", "O arquivo salvo não pôde ser preparado para a biblioteca.");
    const blob = await response.blob();
    if (blob.size <= 0 || (result.size > 0 && blob.size !== result.size)) throw new NativeBookDownloadError("NATIVE_FILE_INCOMPLETE", "O arquivo salvo está incompleto.");
    return new File([blob], link.expectedFilename, { type: result.mimeType });
  }
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
