import type { ApiClient } from "./ApiClient";

export interface DriveCollection { id: string; name: string; rootFolderId: string; contentType: "comic" | "book"; }
/** Decided by the BFF from Drive metadata, never from the filename. */
export type DriveEntryFormat = "pdf" | "epub" | "cbr" | "cbz" | "unknown";
export interface DriveFolderEntry {
  id: string; name: string; kind: "folder" | "file"; mimeType: string;
  description?: string; thumbnailUrl?: string;
  format: DriveEntryFormat | null;
  /** False for a format Lumeo cannot open yet, such as CBR. Still listed, never hidden. */
  supported: boolean;
  contentType?: "comic" | "book";
  size: number | null; modifiedAt: string | null; shortcut?: boolean;
}
export interface DriveFolderListing {
  collectionId: string; folderId: string;
  breadcrumb: readonly { id: string; name: string }[];
  entries: readonly DriveFolderEntry[];
  warnings?: readonly { code: string; entryId: string; name: string }[];
}

/** Browses a published Drive folder through the BFF. The reader never signs in to Google:
 *  the credential lives on the server and only folder metadata ever crosses the wire.
 *
 *  One folder per request, cached by Drive folder id for the session, so walking back up a
 *  saga is instant and costs nothing. */
export class DriveCollectionService {
  private collections: Promise<readonly DriveCollection[]> | null = null;
  private readonly folders = new Map<string, DriveFolderListing>();

  public constructor(private readonly api: ApiClient) {}

  public list(): Promise<readonly DriveCollection[]> {
    this.collections ??= this.api.get<{ items: DriveCollection[] }>("/collections", false)
      .then(body => body.items ?? [])
      .catch(() => { this.collections = null; return []; });
    return this.collections;
  }

  /** `path` is the trail of folder ids from the collection root to `folderId`. The BFF
   *  verifies it against Drive: a folder cannot be opened by guessing its id. */
  public async open(collectionId: string, folderId?: string, path?: readonly string[]): Promise<DriveFolderListing> {
    const key = `${collectionId}:${folderId ?? ""}`;
    const cached = this.folders.get(key);
    if (cached) return cached;
    const suffix = folderId ? `/${encodeURIComponent(folderId)}` : "";
    const query = folderId && path?.length ? `?path=${encodeURIComponent(path.join(","))}` : "";
    const listing = await this.api.get<DriveFolderListing>(`/collections/${encodeURIComponent(collectionId)}/folders${suffix}${query}`, false);
    this.folders.set(key, listing);
    // The same folder reached by its own id and as a collection root is one folder.
    this.folders.set(`${collectionId}:${listing.folderId}`, listing);
    return listing;
  }

  public isCached(collectionId: string, folderId?: string): boolean {
    return this.folders.has(`${collectionId}:${folderId ?? ""}`);
  }
  public forget(): void { this.folders.clear(); this.collections = null; }
}
