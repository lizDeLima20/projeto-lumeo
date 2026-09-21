import { ApiError } from "../errors/ApiError.js";
import { DriveFolderBrowser, DriveFolderUnavailableError } from "./DriveFolderBrowser.js";
import { DriveFolderCache } from "./DriveFolderCache.js";
import { sortEntries } from "./NaturalOrder.js";
import type { DriveCollection, DriveFolderEntry, DriveFolderListing } from "./types.js";

/** Serves one folder of one published collection. The Drive tree is the navigation, so
 *  nothing here knows a folder name, a depth or a saga: it only ever answers "what is
 *  inside this folder". */
export class DriveCollectionService {
  private readonly entryCache: DriveFolderCache<readonly DriveFolderEntry[]>;
  private static readonly maxDepth = 12;

  public constructor(
    private readonly collections: readonly DriveCollection[],
    private readonly browser: DriveFolderBrowser,
    caches: { entries?: DriveFolderCache<readonly DriveFolderEntry[]> } = {},
  ) {
    this.entryCache = caches.entries ?? new DriveFolderCache<readonly DriveFolderEntry[]>();
  }

  public list(): readonly DriveCollection[] { return this.collections; }

  public async open(collectionId: string, folderId?: string, path?: readonly string[]): Promise<DriveFolderListing> {
    const collection = this.collections.find(item => item.id === collectionId);
    if (!collection) throw new ApiError(404, "COLLECTION_NOT_FOUND", "Esta coleção não existe.");
    const target = folderId?.trim() || collection.rootFolderId;
    const breadcrumb = await this.breadcrumb(collection, target, path);
    const entries = sortEntries(await this.entries(target, collection));
    return { collectionId: collection.id, folderId: target, breadcrumb, entries, warnings: [...this.browser.warnings] };
  }

  private async entries(folderId: string, collection: DriveCollection): Promise<readonly DriveFolderEntry[]> {
    const cached = this.entryCache.get(folderId);
    if (cached) return cached;
    const entries = await this.guard(() => this.browser.children(folderId, collection));
    this.entryCache.set(folderId, entries);
    return entries;
  }

  /** Walks *down* from the collection root along the path the reader actually followed,
   *  checking at every step that the next folder really is a child of the previous one.
   *
   *  Walking up would be the obvious way, but the real source proved it impossible: a
   *  folder shared by link answers `files.get` without a `parents` field, so there is no
   *  chain to climb. Descending needs only `files.list`, which does work - and it costs
   *  nothing extra, because each step is a listing that is cached anyway and it supplies
   *  the breadcrumb names for free. */
  private async breadcrumb(collection: DriveCollection, folderId: string, path?: readonly string[]): Promise<readonly { id: string; name: string }[]> {
    const root = { id: collection.rootFolderId, name: collection.name };
    if (folderId === collection.rootFolderId) return [root];
    const steps = this.normalizePath(collection, folderId, path);
    const trail = [root];
    for (let index = 1; index < steps.length; index++) {
      const parent = steps[index - 1]!, child = steps[index]!;
      const children = await this.entries(parent, collection);
      const match = children.find(entry => entry.id === child && entry.kind === "folder");
      if (!match) throw new ApiError(404, "COLLECTION_FOLDER_NOT_FOUND", "Esta pasta não pertence a esta coleção.");
      trail.push({ id: match.id, name: match.name });
    }
    return trail;
  }

  /** The path must start at the root and end at the folder being opened. A folder id with
   *  no path cannot be proven to belong here, so it is refused rather than trusted. */
  private normalizePath(collection: DriveCollection, folderId: string, path?: readonly string[]): readonly string[] {
    const steps = (path ?? []).filter(step => step.trim());
    if (!steps.length) throw new ApiError(404, "COLLECTION_FOLDER_NOT_FOUND", "Esta pasta não pertence a esta coleção.");
    if (steps[0] !== collection.rootFolderId) throw new ApiError(404, "COLLECTION_FOLDER_NOT_FOUND", "Esta pasta não pertence a esta coleção.");
    if (steps[steps.length - 1] !== folderId) throw new ApiError(404, "COLLECTION_FOLDER_NOT_FOUND", "Esta pasta não pertence a esta coleção.");
    if (steps.length > DriveCollectionService.maxDepth) throw new ApiError(400, "COLLECTION_PATH_TOO_DEEP", "Caminho longo demais.");
    if (new Set(steps).size !== steps.length) throw new ApiError(400, "COLLECTION_PATH_INVALID", "Caminho inválido.");
    return steps;
  }

  private async guard<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (error instanceof DriveFolderUnavailableError) {
        if (error.httpStatus === 404) throw new ApiError(404, "COLLECTION_FOLDER_NOT_FOUND", "Esta pasta não está mais disponível.");
        throw new ApiError(503, "COLLECTION_SOURCE_UNAVAILABLE", "Não foi possível ler esta coleção agora.");
      }
      throw error;
    }
  }
}
