import type { CatalogDownloadLink } from "./CatalogService";

export type CatalogDownloadErrorCode =
  | "GOOGLE_DRIVE_CORS_BLOCKED"
  | "GOOGLE_DRIVE_HTML_RESPONSE"
  | "GOOGLE_DRIVE_FILE_NOT_FOUND"
  | "GOOGLE_DRIVE_ACCESS_DENIED"
  | "GOOGLE_DRIVE_REDIRECT_FAILED"
  | "DOWNLOAD_NETWORK_FAILED"
  | "DOWNLOAD_INTEGRITY_FAILED"
  | "GOOGLE_DRIVE_INVALID_FILE";

/** Error whose stable code may be shown in diagnostics without exposing browser or Drive internals. */
export class CatalogDirectDownloadError extends Error {
  public constructor(public readonly code: CatalogDownloadErrorCode, cause?: unknown) {
    super(code);
    this.name = "CatalogDirectDownloadError";
    if (cause !== undefined) this.cause = cause;
  }
}

export function catalogDownloadCode(error: unknown): CatalogDownloadErrorCode | null {
  return error instanceof CatalogDirectDownloadError ? error.code : null;
}

/**
 * Browser-side public Drive downloader. The BFF only authorizes the catalogue
 * item and returns metadata; the PDF/EPUB bytes always remain Drive → browser.
 */
export class GoogleDrivePublicProvider {
  public async download(download: CatalogDownloadLink, onProgress: (percent: number | null) => void, signal?: AbortSignal): Promise<File> {
    const urls = [...new Set([download.downloadUrl, ...(download.downloadUrls ?? [])])];
    let latest: CatalogDirectDownloadError | null = null;
    for (const [attempt, downloadUrl] of urls.entries()) {
      try { return await this.downloadFromUrl(download, downloadUrl, attempt, onProgress, signal); }
      catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        if (!(error instanceof CatalogDirectDownloadError)) throw error;
        latest = error;
        this.log("DIRECT_DOWNLOAD_FAILED", { bookId: download.bookId, driveFileId: download.driveFileId, code: error.code, attempt: attempt + 1, hasFallback: attempt < urls.length - 1 });
      }
    }
    throw latest ?? new CatalogDirectDownloadError("DOWNLOAD_NETWORK_FAILED");
  }

  private async downloadFromUrl(download: CatalogDownloadLink, downloadUrl: string, attempt: number, onProgress: (percent: number | null) => void, signal?: AbortSignal): Promise<File> {
    this.log("DIRECT_DOWNLOAD_REQUEST", { bookId: download.bookId, driveFileId: download.driveFileId, downloadUrl, attempt: attempt + 1, environment: this.environment() });
    this.assertDownloadUrl(downloadUrl);
    let response: Response;
    try {
      response = await fetch(downloadUrl, { signal, credentials: "omit", redirect: "follow" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      const code = error instanceof TypeError && navigator.onLine ? "GOOGLE_DRIVE_CORS_BLOCKED" : "DOWNLOAD_NETWORK_FAILED";
      this.log("DIRECT_DOWNLOAD_FAILED", { bookId: download.bookId, driveFileId: download.driveFileId, code, error: this.errorName(error) });
      throw new CatalogDirectDownloadError(code, error);
    }
    this.log("DIRECT_DOWNLOAD_HTTP_STATUS", { bookId: download.bookId, driveFileId: download.driveFileId, status: response.status, redirected: response.redirected });
    if (response.redirected) this.log("DIRECT_DOWNLOAD_REDIRECT", { bookId: download.bookId, driveFileId: download.driveFileId, finalUrl: response.url });
    if (response.type === "opaque" || response.type === "opaqueredirect") {
      this.log("DIRECT_DOWNLOAD_FAILED", { bookId: download.bookId, driveFileId: download.driveFileId, code: "GOOGLE_DRIVE_CORS_BLOCKED" });
      throw new CatalogDirectDownloadError("GOOGLE_DRIVE_CORS_BLOCKED");
    }
    if (!response.ok) {
      const code = response.status === 404 ? "GOOGLE_DRIVE_FILE_NOT_FOUND" : response.status === 401 || response.status === 403 ? "GOOGLE_DRIVE_ACCESS_DENIED" : response.status >= 300 && response.status < 400 ? "GOOGLE_DRIVE_REDIRECT_FAILED" : "DOWNLOAD_NETWORK_FAILED";
      this.log("DIRECT_DOWNLOAD_FAILED", { bookId: download.bookId, driveFileId: download.driveFileId, code, status: response.status });
      throw new CatalogDirectDownloadError(code);
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    this.log("DIRECT_DOWNLOAD_CONTENT_TYPE", { bookId: download.bookId, driveFileId: download.driveFileId, contentType });
    if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
      this.log("DIRECT_DOWNLOAD_FAILED", { bookId: download.bookId, driveFileId: download.driveFileId, code: "GOOGLE_DRIVE_HTML_RESPONSE" });
      throw new CatalogDirectDownloadError("GOOGLE_DRIVE_HTML_RESPONSE");
    }
    const file = await this.toFile(response, download, onProgress);
    await this.assertFile(file, download);
    return file;
  }

  private async toFile(response: Response, download: CatalogDownloadLink, onProgress: (percent: number | null) => void): Promise<File> {
    const expectedLength = Number(response.headers.get("content-length")) || download.fileSize || 0;
    const reader = response.body?.getReader();
    const chunks: BlobPart[] = []; let received = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value); received += value.byteLength;
          onProgress(expectedLength ? Math.min(100, Math.round(received / expectedLength * 100)) : null);
        }
      }
    } else chunks.push(await response.blob());
    const extension = download.format === "pdf" ? "pdf" : "epub";
    const mime = download.format === "pdf" ? "application/pdf" : "application/epub+zip";
    return new File(chunks, `${this.fileStem(download.title)}.${extension}`, { type: mime });
  }

  private async assertFile(file: File, download: CatalogDownloadLink): Promise<void> {
    const prefix = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const pdf = new TextDecoder().decode(prefix).startsWith("%PDF-");
    const epub = prefix[0] === 0x50 && prefix[1] === 0x4b;
    if (!(download.format === "pdf" ? pdf : epub)) {
      const code = this.looksLikeHtml(prefix) ? "GOOGLE_DRIVE_HTML_RESPONSE" : "GOOGLE_DRIVE_INVALID_FILE";
      this.log("DIRECT_DOWNLOAD_FAILED", { bookId: download.bookId, driveFileId: download.driveFileId, code });
      throw new CatalogDirectDownloadError(code);
    }
    if (download.sha256 && await this.sha256(file) !== download.sha256.toLowerCase()) {
      this.log("DIRECT_DOWNLOAD_FAILED", { bookId: download.bookId, driveFileId: download.driveFileId, code: "DOWNLOAD_INTEGRITY_FAILED" });
      throw new CatalogDirectDownloadError("DOWNLOAD_INTEGRITY_FAILED");
    }
  }

  private assertDownloadUrl(value: string): void {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !["drive.google.com", "drive.usercontent.google.com"].includes(url.hostname)) throw new Error("unsupported host");
    } catch { throw new CatalogDirectDownloadError("GOOGLE_DRIVE_REDIRECT_FAILED"); }
  }
  private fileStem(title: string): string { return title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "livro"; }
  private looksLikeHtml(prefix: Uint8Array): boolean { return /^\s*(<!doctype|<html|<head)/i.test(new TextDecoder().decode(prefix)); }
  private async sha256(file: Blob): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer()); return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join(""); }
  private environment(): "mobile" | "desktop" { return typeof navigator !== "undefined" && /android|iphone|ipad|mobile/i.test(navigator.userAgent) ? "mobile" : "desktop"; }
  private errorName(error: unknown): string { return error instanceof Error ? error.name : "UnknownError"; }
  private log(event: string, details: Record<string, unknown>): void { console.info(JSON.stringify({ event, ...details })); }
}
