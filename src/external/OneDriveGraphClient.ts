import type { OneDriveAuth } from "./OneDriveAuthManager";
import { checkCancelled, OneDriveError } from "./OneDriveError";
export class OneDriveGraphClient {
  public static readonly ROOT = "https://graph.microsoft.com/v1.0/";
  public constructor(private readonly auth: OneDriveAuth, private readonly fetcher: typeof fetch = fetch) {}
  public async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    checkCancelled(signal);
    if (globalThis.navigator?.onLine === false) throw new OneDriveError("import.download.offline");
    const url = new URL(path, OneDriveGraphClient.ROOT);
    if (url.origin !== "https://graph.microsoft.com" || !url.pathname.startsWith("/v1.0/") || url.username || url.password) throw new OneDriveError("onedrive.invalidLink");
    const timeout = AbortSignal.timeout(30_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const token = await this.auth.token(); checkCancelled(signal);
    try {
      const response = await this.fetcher(url, { method: "GET", signal: combined, credentials: "omit", referrerPolicy: "no-referrer",
        redirect: "error", headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (response.status === 401) { this.auth.invalidate(); throw new OneDriveError("onedrive.authRequired"); }
      if (response.status === 403) throw new OneDriveError(token ? "onedrive.denied" : "onedrive.authRequired");
      if (response.status === 404) throw new OneDriveError(token ? "onedrive.notFound" : "onedrive.authRequired");
      if (response.status === 429 || response.status === 503) throw new OneDriveError("onedrive.quota");
      if (!response.ok) throw new OneDriveError("import.remote.failed");
      return await response.json() as T;
    } catch (error) {
      checkCancelled(signal);
      if (error instanceof OneDriveError) throw error;
      throw new OneDriveError(timeout.aborted ? "import.download.timeout" : "import.remote.failed");
    }
  }
}
