import type { CatalogDownloadLink } from "./CatalogService";
import { GoogleDriveAuthorizationError, GoogleDriveAuthorizationProvider } from "./GoogleDriveAuthorizationProvider";

export type CatalogDownloadErrorCode = "GOOGLE_DRIVE_AUTH_NOT_CONFIGURED" | "GOOGLE_DRIVE_CONSENT_DENIED" | "GOOGLE_DRIVE_TOKEN_EXPIRED" | "GOOGLE_DRIVE_API_UNAUTHORIZED" | "GOOGLE_DRIVE_ACCESS_DENIED" | "GOOGLE_DRIVE_FILE_NOT_FOUND" | "GOOGLE_DRIVE_CANNOT_DOWNLOAD" | "GOOGLE_DRIVE_HTML_RESPONSE" | "DOWNLOAD_NETWORK_FAILED" | "DOWNLOAD_INTEGRITY_FAILED" | "GOOGLE_DRIVE_INVALID_FILE";
export class CatalogDirectDownloadError extends Error { public constructor(public readonly code: CatalogDownloadErrorCode, cause?: unknown) { super(code); this.name = "CatalogDirectDownloadError"; if (cause !== undefined) this.cause = cause; } }
export function catalogDownloadCode(error: unknown): CatalogDownloadErrorCode | null { return error instanceof CatalogDirectDownloadError ? error.code : null; }

/** Official Drive API downloader. It sends no bytes through the Lumeo BFF. */
export class GoogleDriveApiProvider {
  public constructor(private readonly authorization = new GoogleDriveAuthorizationProvider(), private readonly fetcher: typeof fetch = fetch) {}
  public clearAuthorization(): void { this.authorization.clear(); }
  public async download(download: CatalogDownloadLink, onProgress: (percent: number | null) => void, signal?: AbortSignal): Promise<File> {
    this.log("DRIVE_API_DOWNLOAD_REQUEST", { bookId: download.bookId, driveFileId: download.driveFileId });
    try {
      const token = await this.authorization.accessToken(), metadata = await this.metadata(download, token, signal);
      if (metadata.capabilities?.canDownload === false) throw new CatalogDirectDownloadError("GOOGLE_DRIVE_CANNOT_DOWNLOAD");
      const response = await this.request(download, token, "?alt=media&supportsAllDrives=true", signal);
      this.log("DRIVE_API_DOWNLOAD_STATUS", { bookId: download.bookId, driveFileId: download.driveFileId, status: response.status });
      if (!response.ok) throw this.statusError(response.status);
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase(); this.log("DRIVE_API_DOWNLOAD_CONTENT_TYPE", { bookId: download.bookId, driveFileId: download.driveFileId, contentType });
      if (contentType.includes("text/html") || contentType.includes("application/xhtml")) throw new CatalogDirectDownloadError("GOOGLE_DRIVE_HTML_RESPONSE");
      const file = await this.toFile(response, download, metadata, onProgress); await this.assertFile(file, download);
      this.log("DRIVE_API_DOWNLOAD_SUCCESS", { bookId: download.bookId, driveFileId: download.driveFileId, bytes: file.size }); return file;
    } catch (error) { const typed = this.error(error); this.log("DRIVE_API_DOWNLOAD_FAILED", { bookId: download.bookId, driveFileId: download.driveFileId, code: typed.code }); throw typed; }
  }
  private async metadata(download: CatalogDownloadLink, token: string, signal?: AbortSignal): Promise<{ name?: string; mimeType?: string; size?: string; resourceKey?: string; capabilities?: { canDownload?: boolean } }> {
    const response = await this.request(download, token, "?fields=name,mimeType,size,resourceKey,capabilities(canDownload),webContentLink&supportsAllDrives=true", signal); if (!response.ok) throw this.statusError(response.status); return response.json();
  }
  private request(download: CatalogDownloadLink, token: string, query: string, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` }; if (download.resourceKey) headers["X-Goog-Drive-Resource-Keys"] = `${download.driveFileId}/${download.resourceKey}`;
    return this.fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(download.driveFileId)}${query}`, { headers, signal, credentials: "omit", referrerPolicy: "no-referrer" });
  }
  private async toFile(response: Response, download: CatalogDownloadLink, metadata: { name?: string; mimeType?: string; size?: string }, onProgress: (percent: number | null) => void): Promise<File> {
    const expectedLength = Number(response.headers.get("content-length")) || Number(metadata.size) || download.fileSize || 0, chunks: BlobPart[] = []; let received = 0, reader = response.body?.getReader();
    if (reader) { try { while (true) { const { done, value } = await reader.read(); if (done) break; if (value) { chunks.push(value); received += value.byteLength; onProgress(expectedLength ? Math.min(100, Math.round(received / expectedLength * 100)) : null); } } } finally { reader.releaseLock(); } } else chunks.push(await response.blob());
    const extension = download.format === "pdf" ? "pdf" : "epub", mime = download.format === "pdf" ? "application/pdf" : "application/epub+zip";
    return new File(chunks, metadata.name?.trim() || `${this.fileStem(download.title)}.${extension}`, { type: metadata.mimeType || mime });
  }
  private async assertFile(file: File, download: CatalogDownloadLink): Promise<void> {
    const prefix = new Uint8Array(await file.slice(0, 8).arrayBuffer()), pdf = new TextDecoder().decode(prefix).startsWith("%PDF-"), epub = prefix[0] === 0x50 && prefix[1] === 0x4b;
    if (!(download.format === "pdf" ? pdf : epub)) throw new CatalogDirectDownloadError(this.looksLikeHtml(prefix) ? "GOOGLE_DRIVE_HTML_RESPONSE" : "GOOGLE_DRIVE_INVALID_FILE");
    if (download.sha256 && await this.sha256(file) !== download.sha256.toLowerCase()) throw new CatalogDirectDownloadError("DOWNLOAD_INTEGRITY_FAILED");
  }
  private statusError(status: number): CatalogDirectDownloadError { return new CatalogDirectDownloadError(status === 401 ? "GOOGLE_DRIVE_API_UNAUTHORIZED" : status === 403 ? "GOOGLE_DRIVE_ACCESS_DENIED" : status === 404 ? "GOOGLE_DRIVE_FILE_NOT_FOUND" : "DOWNLOAD_NETWORK_FAILED"); }
  private error(error: unknown): CatalogDirectDownloadError { if (error instanceof CatalogDirectDownloadError) return error; if (error instanceof GoogleDriveAuthorizationError) return new CatalogDirectDownloadError(error.code, error); return new CatalogDirectDownloadError("DOWNLOAD_NETWORK_FAILED", error); }
  private fileStem(title: string): string { return title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "livro"; }
  private looksLikeHtml(prefix: Uint8Array): boolean { return /^\s*(<!doctype|<html|<head)/i.test(new TextDecoder().decode(prefix)); }
  private async sha256(file: Blob): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer()); return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join(""); }
  private log(event: string, details: Record<string, unknown>): void { console.info(JSON.stringify({ event, ...details })); }
}
