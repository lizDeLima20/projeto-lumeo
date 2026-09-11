import { I18nManager } from "../i18n/I18nManager";
import { BookDownloadError, StartTelemetry } from "../diagnostics/StartTelemetry";
export interface GoogleLibraryFile { id: string; name: string; mimeType: string; size?: string; resourceKey?: string; }
interface GoogleTokenReply { access_token?: string; expires_in?: number; }
interface GoogleIdentity { accounts: { oauth2: { initTokenClient(config: {
  client_id: string; scope: string; callback(response: GoogleTokenReply): void; error_callback(): void;
}): { requestAccessToken(): void } } } }
class GoogleDriveRequestError extends Error {
  public constructor(public readonly status: number, cause?: unknown) { super("Google Drive request failed"); this.name = "GoogleDriveRequestError"; Object.defineProperty(this, "cause", { value: cause, enumerable: false }); }
}
export class GoogleDriveLibraryService {
  public static readonly FOLDER = "application/vnd.google-apps.folder";
  private token = ""; private expires = 0; private loading: Promise<void> | null = null;
  private readonly downloads = new Map<string, Promise<File>>();
  public constructor(private readonly clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "", private readonly fetcher: typeof fetch = fetch) {}
  public get configured(): boolean { return Boolean(this.clientId); }
  public get authorized(): boolean { return !!this.token && Date.now() < this.expires; }
  private error(): Error { return new Error(I18nManager.shared.t("google.failed")); }
  private identity(): GoogleIdentity | undefined { return (window as Window & { google?: GoogleIdentity }).google; }
  public prepare(): Promise<void> {
    if (!this.configured) return Promise.reject(new Error(I18nManager.shared.t("google.notConfigured")));
    if (this.identity()?.accounts?.oauth2) return Promise.resolve();
    return this.loading ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement("script"); script.src = "https://accounts.google.com/gsi/client"; script.async = true;
      const timer = window.setTimeout(() => finish(false), 20_000);
      const finish = (ok: boolean): void => { clearTimeout(timer); script.onload = null; script.onerror = null;
        if (ok) resolve(); else { script.remove(); this.loading = null; reject(this.error()); } };
      script.onload = () => finish(!!this.identity()?.accounts?.oauth2); script.onerror = () => finish(false); document.head.append(script);
    });
  }
  /** Called synchronously by the explicit Connect button after loading GIS. */
  public connect(): Promise<void> {
    const identity = this.identity(); if (!identity) return Promise.reject(this.error());
    return new Promise((resolve, reject) => {
      identity.accounts.oauth2.initTokenClient({ client_id: this.clientId,
        // Arbitrary saved folder links require read access; never request writes.
        scope: "https://www.googleapis.com/auth/drive.readonly",
        callback: result => { if (!result.access_token) return reject(this.error());
          this.token = result.access_token; this.expires = Date.now() + (result.expires_in ?? 3600) * 1000 - 30_000; resolve(); },
        error_callback: () => reject(this.error()),
      }).requestAccessToken();
    });
  }
  public dispose(): void { this.token = ""; this.expires = 0; }
  private async request(path: string, signal: AbortSignal, resource?: { id: string; key?: string }): Promise<Response> {
    if (!this.authorized) throw this.error();
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    if (resource?.key) headers["X-Goog-Drive-Resource-Keys"] = `${resource.id}/${resource.key}`;
    const response = await this.fetcher(`https://www.googleapis.com/drive/v3/${path}`, {
      headers, signal, credentials: "omit", referrerPolicy: "no-referrer",
    });
    if (response.status === 401) this.dispose();
    if (!response.ok) throw new GoogleDriveRequestError(response.status); return response;
  }
  public async list(id: string, key: string | undefined, signal: AbortSignal, pageToken?: string): Promise<{ files: GoogleLibraryFile[]; nextPageToken?: string }> {
    if (!/^[\w-]+$/.test(id)) throw this.error();
    const timed = portableTimeout(signal, 30_000);
    try {
      const folder = await (await this.request(`files/${encodeURIComponent(id)}?fields=mimeType&supportsAllDrives=true`, timed.signal, { id, key })).json() as GoogleLibraryFile;
      if (folder.mimeType !== GoogleDriveLibraryService.FOLDER) throw this.error();
      const query = new URLSearchParams({ q: `'${id}' in parents and trashed=false`, pageSize: "100",
        fields: "nextPageToken,files(id,name,mimeType,size,resourceKey)", orderBy: "folder,name_natural", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
      if (pageToken) query.set("pageToken", pageToken);
      const result = await (await this.request(`files?${query}`, timed.signal, { id, key })).json() as { files: GoogleLibraryFile[]; nextPageToken?: string };
      return { ...result, files: result.files.filter(file => file.mimeType === GoogleDriveLibraryService.FOLDER || /\.(pdf|epub|lima)$/i.test(file.name)) };
    } catch (error) {
      if (error instanceof GoogleDriveRequestError) throw this.error();
      throw error;
    } finally { timed.dispose(); }
  }
  public async download(file: GoogleLibraryFile, signal: AbortSignal, progress: (percent: number | null) => void): Promise<File> {
    if (this.downloads.has(file.id)) throw new BookDownloadError("DOWNLOAD_ALREADY_RUNNING", "PREPARING", file.id);
    const job = this.downloadWithRetry(file, signal, progress).finally(() => this.downloads.delete(file.id));
    this.downloads.set(file.id, job); return job;
  }
  private async downloadWithRetry(file: GoogleLibraryFile, signal: AbortSignal, progress: (percent: number | null) => void): Promise<File> {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.downloadOnce(file, signal, progress); }
      catch (error) {
        last = error;
        if (!(error instanceof BookDownloadError) || !error.retryable || signal.aborted || attempt === 2) throw error;
        await new Promise<void>(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw last;
  }
  private async downloadOnce(file: GoogleLibraryFile, signal: AbortSignal, progress: (percent: number | null) => void): Promise<File> {
    const max = 256 * 1024 * 1024, size = Number(file.size) || 0;
    if (size > max || !/\.(pdf|epub)$/i.test(file.name)) throw new BookDownloadError("EPUB_INVALID", "VALIDATING", file.id);
    const endpoint = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`;
    StartTelemetry.request(file.id, endpoint, "DOWNLOADING");
    const timed = portableTimeout(signal, 120_000);
    try {
      const response = await this.request(`files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`, timed.signal, { id: file.id, key: file.resourceKey });
      const reader = response.body?.getReader(); if (!reader) throw new BookDownloadError("MOBILE_API_UNSUPPORTED", "DOWNLOADING", file.id);
      let bytes = 0; const chunks: BlobPart[] = [];
      try { while (true) { assertNotAborted(timed.signal); const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength; if (bytes > max) throw new BookDownloadError("EPUB_INVALID", "VALIDATING", file.id);
        chunks.push(new Uint8Array(value).buffer); progress(size ? Math.min(100, Math.round(bytes / size * 100)) : null);
      } } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      assertNotAborted(timed.signal); if (size && bytes !== size) throw new BookDownloadError("DOWNLOAD_NETWORK_FAILED", "DOWNLOADING", file.id, undefined, true);
      StartTelemetry.request(file.id, endpoint, "VALIDATING");
      return new File(chunks, file.name, { type: file.mimeType || (file.name.endsWith(".epub") ? "application/epub+zip" : "application/pdf") });
    } catch (error) {
      const typed = this.classifyDownloadError(error, file.id, timed.timedOut);
      StartTelemetry.failed(file.id, endpoint, typed.stage, error, typed.status); throw typed;
    } finally { timed.dispose(); }
  }
  private classifyDownloadError(error: unknown, bookId: string, timedOut: boolean): BookDownloadError {
    if (error instanceof BookDownloadError) return error;
    if (error instanceof GoogleDriveRequestError) {
      const code = error.status === 401 ? "DOWNLOAD_HTTP_401" : error.status === 403 ? "DOWNLOAD_HTTP_403" : error.status === 404 ? "DOWNLOAD_HTTP_404" : "DOWNLOAD_URL_FAILED";
      return new BookDownloadError(code, "DOWNLOADING", bookId, error.status, error.status >= 500, error);
    }
    if (timedOut) return new BookDownloadError("DOWNLOAD_TIMEOUT", "DOWNLOADING", bookId, undefined, true, error);
    if (error instanceof DOMException && error.name === "AbortError") return new BookDownloadError("DOWNLOAD_NETWORK_FAILED", "DOWNLOADING", bookId, undefined, true, error);
    return new BookDownloadError(globalThis.navigator?.onLine === false ? "DOWNLOAD_NETWORK_FAILED" : "DOWNLOAD_CORS_FAILED", "DOWNLOADING", bookId, undefined, true, error);
  }
}

function assertNotAborted(signal: AbortSignal): void { if (signal.aborted) throw new DOMException("Download cancelado.", "AbortError"); }
function portableTimeout(parent: AbortSignal, milliseconds: number): { signal: AbortSignal; timedOut: boolean; dispose(): void } {
  const controller = new AbortController(); let timedOut = false;
  const abort = (): void => controller.abort(); parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, milliseconds);
  return { signal: controller.signal, get timedOut() { return timedOut; }, dispose: () => { clearTimeout(timer); parent.removeEventListener("abort", abort); } };
}
