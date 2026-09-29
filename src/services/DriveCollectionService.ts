import type { ApiClient } from "./ApiClient";
import { matchesCatalogText } from "../../shared/CatalogTextSearch";

export interface DriveCollection { id: string; name: string; rootFolderId: string; contentType: "comic" | "book"; navigationMode?: "sections" | "folders"; sourceRootFolderIds?: readonly string[]; }
/** Decided by the BFF from Drive metadata, never from the filename. */
export type DriveEntryFormat = "pdf" | "epub" | "cbr" | "cbz" | "unknown";
export interface DriveFolderEntry {
  id: string; name: string; kind: "folder" | "file"; mimeType: string;
  description?: string; thumbnailUrl?: string;
  format: DriveEntryFormat | null;
  /** False for a format Lumeo cannot open yet, such as CBR. Still listed, never hidden. */
  supported: boolean;
  contentType?: "comic" | "book";
  size: number | null; modifiedAt: string | null;
  parentId?: string; collectionPath?: readonly string[]; shortcut?: boolean;
}
export interface DriveFolderListing {
  collectionId: string; folderId: string;
  breadcrumb: readonly { id: string; name: string }[];
  entries: readonly DriveFolderEntry[];
  warnings?: readonly { code: string; entryId: string; name: string }[];
  sourceRootId?: string;
}
export interface DriveCollectionSearchResult {
  collection: DriveCollection;
  listing: DriveFolderListing;
  entry: DriveFolderEntry;
}
/** One file anywhere in a collection's tree, as the server's flattened /search-index
 *  answers it: the entry itself, and the breadcrumb of the folder it actually sits in. */
interface CollectionIndexEntry { entry: DriveFolderEntry; breadcrumb: readonly { id: string; name: string }[]; }
interface CollectionIndex { collectionId: string; entries: readonly CollectionIndexEntry[]; }

/** Browses a published Drive folder through the BFF. The reader never signs in to Google:
 *  the credential lives on the server and only folder metadata ever crosses the wire.
 *
 *  One folder per request, cached by Drive folder id for the session, so walking back up a
 *  saga is instant and costs nothing. */
export class DriveCollectionService {
  private collections: Promise<readonly DriveCollection[]> | null = null;
  private readonly folders = new Map<string, DriveFolderListing>();
  private readonly indexes = new Map<string, Promise<readonly DriveCollectionSearchResult[]>>();

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
  /** Searches the complete published tree, not only folders/cards already rendered. */
  public async search(query: string, collectionId?: string): Promise<readonly DriveCollectionSearchResult[]> {
    const collections = (await this.list()).filter(collection => !collectionId || collection.id === collectionId);
    const indexed = await Promise.all(collections.map(collection => this.indexCollection(collection).catch(() => [])));
    return indexed.flat().filter(({ collection, listing, entry }) => matchesCatalogText(query, [
      entry.name,
      entry.description,
      collection.name,
      ...listing.breadcrumb.map(step => step.name),
    ]));
  }

  private indexCollection(collection: DriveCollection): Promise<readonly DriveCollectionSearchResult[]> {
    const cached = this.indexes.get(collection.id);
    if (cached) return cached;
    const pending = this.fetchIndex(collection).catch(error => {
      this.indexes.delete(collection.id);
      throw error;
    });
    this.indexes.set(collection.id, pending);
    return pending;
  }

  /** One request for the collection's whole flattened tree - built once, on the server,
   *  from GET /collections/:id/search-index - instead of one request per folder walked
   *  from here. `indexes` still keeps the result (and in-flight promise) for the rest of
   *  the session, so a second search costs nothing further. */
  private async fetchIndex(collection: DriveCollection): Promise<readonly DriveCollectionSearchResult[]> {
    const index = await this.api.get<CollectionIndex>(`/collections/${encodeURIComponent(collection.id)}/search-index`, false);
    return index.entries.map(({ entry, breadcrumb }): DriveCollectionSearchResult => ({
      collection, entry,
      listing: { collectionId: collection.id, folderId: breadcrumb[breadcrumb.length - 1]?.id ?? collection.rootFolderId, breadcrumb, entries: [] },
    }));
  }

  public forget(): void { this.folders.clear(); this.indexes.clear(); this.collections = null; }
}
