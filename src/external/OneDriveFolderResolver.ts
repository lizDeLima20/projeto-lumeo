import { OneDriveError } from "./OneDriveError";
import type { OneDriveGraphClient } from "./OneDriveGraphClient";
export interface OneDriveItem {
  id: string; name: string; size: number;
  folder?: { childCount?: number }; file?: { mimeType: string };
  parentReference?: { driveId?: string }; remoteItem?: OneDriveItem;
  "@microsoft.graph.downloadUrl"?: string;
}
export interface OneDriveFolder { id: string; driveId: string; name: string; }
export class OneDriveFolderResolver {
  public constructor(private readonly graph: OneDriveGraphClient) {}
  public static validateLink(value: string): string {
    let url: URL; try { url = new URL(value.trim()); } catch { throw new OneDriveError("onedrive.invalidLink"); }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port || value.length > 8192 ||
      !(host === "1drv.ms" || host === "onedrive.live.com" || /^[a-z0-9-]+\.sharepoint\.com$/.test(host))) throw new OneDriveError("onedrive.invalidLink");
    if (url.pathname === "/" && !url.search) throw new OneDriveError("onedrive.invalidLink");
    if ([...url.searchParams.keys()].some(key => /^(access_token|refresh_token|client_secret|code)$/i.test(key))) throw new OneDriveError("onedrive.invalidLink");
    url.hash = ""; return url.href;
  }
  public static shareId(value: string): string {
    const bytes = new TextEncoder().encode(OneDriveFolderResolver.validateLink(value));
    return "u!" + btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  }
  public async resolve(link: string, signal?: AbortSignal): Promise<OneDriveFolder> {
    const item = await this.graph.get<OneDriveItem>(`shares/${OneDriveFolderResolver.shareId(link)}/driveItem`, signal);
    const root = item.remoteItem ?? item;
    if (!root.folder || !root.id || !root.parentReference?.driveId) throw new OneDriveError("onedrive.notFolder");
    return { id: root.id, driveId: root.parentReference.driveId, name: root.name };
  }
}
