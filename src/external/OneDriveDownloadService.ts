import type { OneDriveGraphClient } from "./OneDriveGraphClient";
import type { OneDriveItem } from "./OneDriveFolderResolver";
import { OneDriveBrowserService } from "./OneDriveBrowserService";
import { checkCancelled, OneDriveError } from "./OneDriveError";
export class OneDriveDownloadService {
  public static readonly MAX_BYTES = 256 * 1024 * 1024;
  public constructor(private readonly graph: OneDriveGraphClient, private readonly fetcher: typeof fetch = fetch,
    private readonly limit = OneDriveDownloadService.MAX_BYTES) {}
  public async download(driveId: string, itemId: string, progress?: (percent: number | null) => void, signal?: AbortSignal): Promise<File> {
    const item = await this.graph.get<OneDriveItem>(`drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`, signal);
    if (!OneDriveBrowserService.supported(item)) throw new OneDriveError("import.remote.unsupported");
    this.assertSize(item.size);
    const raw = item["@microsoft.graph.downloadUrl"];
    if (!raw) throw new OneDriveError("onedrive.denied");
    let url: URL; try { url = new URL(raw); } catch { throw new OneDriveError("import.download.failed"); }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["files.1drv.com", "storage.live.com", "sharepoint.com", "sharepointonline.com", "onedrive.com"].some(domain => host === domain || host.endsWith(`.${domain}`))) throw new OneDriveError("import.download.failed");
    const timeout = AbortSignal.timeout(120_000); const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      // Preauthenticated URL from Graph: do NOT attach the OAuth token here.
      const response = await this.fetcher(url, { method: "GET", signal: combined, credentials: "omit", referrerPolicy: "no-referrer" });
      if ([401, 403, 404].includes(response.status)) throw new OneDriveError("onedrive.notFound");
      if (response.status === 429) throw new OneDriveError("onedrive.quota");
      if (!response.ok) throw new OneDriveError("import.download.failed");
      this.assertSize(Number(response.headers.get("content-length")) || 0);
      const chunks: BlobPart[] = []; let received = 0;
      const reader = response.body?.getReader();
      if (!reader) throw new OneDriveError("import.download.interrupted");
      const cancel = (): void => { void reader.cancel().catch(() => undefined); };
      combined.addEventListener("abort", cancel, { once: true });
      try {
        while (true) {
          checkCancelled(combined); const { done, value } = await reader.read(); checkCancelled(combined);
          if (done) break;
          received += value.byteLength; this.assertSize(received);
          chunks.push(new Uint8Array(value).buffer); progress?.(item.size ? Math.min(100, Math.round(received / item.size * 100)) : null);
        }
      } finally { combined.removeEventListener("abort", cancel); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      if (received !== item.size) throw new OneDriveError("import.download.interrupted");
      checkCancelled(signal); return new File(chunks, item.name, { type: item.file?.mimeType || "application/octet-stream" });
    } catch (error) {
      checkCancelled(signal);
      if (timeout.aborted) throw new OneDriveError("import.download.timeout");
      if (error instanceof OneDriveError) throw error;
      throw new OneDriveError(globalThis.navigator?.onLine === false ? "import.download.offline" : "import.download.interrupted");
    }
  }
  private assertSize(size: number): void { if (!Number.isFinite(size) || size < 0 || size > this.limit) throw new OneDriveError("import.download.tooLarge"); }
}
