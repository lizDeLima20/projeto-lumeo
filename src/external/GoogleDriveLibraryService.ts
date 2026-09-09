import { I18nManager } from "../i18n/I18nManager";
export interface GoogleLibraryFile { id: string; name: string; mimeType: string; size?: string; resourceKey?: string; }
interface GoogleTokenReply { access_token?: string; expires_in?: number; }
interface GoogleIdentity { accounts: { oauth2: { initTokenClient(config: {
  client_id: string; scope: string; callback(response: GoogleTokenReply): void; error_callback(): void;
}): { requestAccessToken(): void } } } }
export class GoogleDriveLibraryService {
  public static readonly FOLDER = "application/vnd.google-apps.folder";
  private token = ""; private expires = 0; private loading: Promise<void> | null = null;
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
    if (!response.ok) throw this.error(); return response;
  }
  public async list(id: string, key: string | undefined, signal: AbortSignal, pageToken?: string): Promise<{ files: GoogleLibraryFile[]; nextPageToken?: string }> {
    if (!/^[\w-]+$/.test(id)) throw this.error();
    const combined = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    const folder = await (await this.request(`files/${encodeURIComponent(id)}?fields=mimeType&supportsAllDrives=true`, combined, { id, key })).json() as GoogleLibraryFile;
    if (folder.mimeType !== GoogleDriveLibraryService.FOLDER) throw this.error();
    const query = new URLSearchParams({ q: `'${id}' in parents and trashed=false`, pageSize: "100",
      fields: "nextPageToken,files(id,name,mimeType,size,resourceKey)", orderBy: "folder,name_natural", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
    if (pageToken) query.set("pageToken", pageToken);
    const result = await (await this.request(`files?${query}`, combined, { id, key })).json() as { files: GoogleLibraryFile[]; nextPageToken?: string };
    return { ...result, files: result.files.filter(file => file.mimeType === GoogleDriveLibraryService.FOLDER || /\.(pdf|epub|lima)$/i.test(file.name)) };
  }
  public async download(file: GoogleLibraryFile, signal: AbortSignal, progress: (percent: number | null) => void): Promise<File> {
    const max = 256 * 1024 * 1024, size = Number(file.size) || 0;
    if (size > max || !/\.(pdf|epub)$/i.test(file.name)) throw this.error();
    const combined = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    const response = await this.request(`files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`, combined, { id: file.id, key: file.resourceKey });
    const reader = response.body?.getReader(); if (!reader) throw this.error();
    let bytes = 0; const chunks: BlobPart[] = [];
    try { while (true) { combined.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > max) throw this.error(); chunks.push(new Uint8Array(value).buffer);
      progress(size ? Math.min(100, Math.round(bytes / size * 100)) : null);
    } } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    combined.throwIfAborted(); if (size && bytes !== size) throw this.error();
    return new File(chunks, file.name, { type: file.mimeType });
  }
}
