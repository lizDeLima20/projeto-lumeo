import type { OneDriveGraphClient } from "./OneDriveGraphClient";
import type { OneDriveFolder, OneDriveItem } from "./OneDriveFolderResolver";
import { OneDriveError } from "./OneDriveError";
export interface OneDriveListing { items: OneDriveItem[]; nextLink?: string; }
export class OneDriveBrowserService {
  public constructor(private readonly graph: OneDriveGraphClient) {}
  public static supported(item: OneDriveItem): boolean { return !!item.file && /\.(pdf|epub)$/i.test(item.name); }
  public static visible(item: OneDriveItem): boolean { return !!item.folder || OneDriveBrowserService.supported(item) || !!item.file && /\.lima$/i.test(item.name); }
  public async list(folder: OneDriveFolder, signal?: AbortSignal, nextLink?: string): Promise<OneDriveListing> {
    const data = await this.graph.get<{ value: OneDriveItem[]; "@odata.nextLink"?: string }>(nextLink ??
      `drives/${encodeURIComponent(folder.driveId)}/items/${encodeURIComponent(folder.id)}/children?$select=id,name,size,folder,file,parentReference&$top=100`, signal);
    if (!Array.isArray(data.value)) throw new OneDriveError("import.remote.failed");
    const items = data.value.filter(item => typeof item.id === "string" && typeof item.name === "string" && OneDriveBrowserService.visible(item));
    items.sort((a, b) => Number(!!b.folder) - Number(!!a.folder) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    return { items, nextLink: data["@odata.nextLink"] };
  }
}
