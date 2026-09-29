import { ApiError } from "../errors/ApiError.js";
import type { CollectionIndexStore } from "./CollectionIndexStore.js";
import { DriveFolderBrowser, DriveFolderUnavailableError } from "./DriveFolderBrowser.js";
import { DriveFolderCache } from "./DriveFolderCache.js";
import { sortEntries } from "./NaturalOrder.js";
import type { CollectionIndex, CollectionIndexEntry, DriveCollection, DriveFolderEntry, DriveFolderListing } from "./types.js";

/** Serves one folder of one published collection. The Drive tree is the navigation, so
 *  nothing here knows a folder name, a depth or a saga: it only ever answers "what is
 *  inside this folder". */
export class DriveCollectionService {
  private readonly entryCache: DriveFolderCache<readonly DriveFolderEntry[]>;
  /** Caches the *promise*, not just the result: two searches arriving together for the
   *  same collection share the one crawl in flight instead of starting two. A failed
   *  build evicts itself immediately, so the next request retries rather than waiting out
   *  the rest of the TTL on a dead entry. This is an optimization only - serverless
   *  instances do not share memory, so a cold instance still pays for its own first
   *  crawl - never a guarantee of a warm index. */
  private readonly indexCache: DriveFolderCache<Promise<CollectionIndex>>;
  private static readonly maxDepth = 32;
  /** Bounds a pathological tree (a cycle the visited-set already guards against, or simply
   *  an unexpectedly huge folder) so one bad collection cannot hang the request forever. */
  private static readonly maxIndexedFolders = 20_000;

  public constructor(
    private readonly collections: readonly DriveCollection[],
    private readonly browser: DriveFolderBrowser,
    caches: { entries?: DriveFolderCache<readonly DriveFolderEntry[]>; index?: DriveFolderCache<Promise<CollectionIndex>> } = {},
    private readonly store?: CollectionIndexStore,
  ) {
    this.entryCache = caches.entries ?? new DriveFolderCache<readonly DriveFolderEntry[]>();
    this.indexCache = caches.index ?? new DriveFolderCache<Promise<CollectionIndex>>(300_000, 20);
  }

  public list(): readonly DriveCollection[] { return this.collections; }

  /** A user's search: reads the index the separate rebuild already materialized. Never
   *  crawls Drive itself - a large collection's crawl can take well over a minute, and
   *  nobody's search should ever pay for that. Missing or unreadable index fails fast
   *  (COLLECTION_INDEX_UNAVAILABLE) instead of silently falling back to a live crawl. */
  public async searchIndex(collectionId: string): Promise<CollectionIndex> {
    const collection = this.collections.find(item => item.id === collectionId);
    if (!collection) throw new ApiError(404, "COLLECTION_NOT_FOUND", "Esta coleção não existe.");
    const cached = this.indexCache.get(collectionId);
    if (cached) return cached;
    const pending = this.loadIndex(collection);
    this.indexCache.set(collectionId, pending);
    pending.catch(() => this.indexCache.delete(collectionId));
    return pending;
  }

  private async loadIndex(collection: DriveCollection): Promise<CollectionIndex> {
    const stored = this.store ? await this.store.get(collection.id) : null;
    if (!stored) throw new ApiError(503, "COLLECTION_INDEX_UNAVAILABLE", "O índice de busca desta coleção ainda não está pronto.");
    return stored;
  }

  /** The expensive crawl - only ever run by the separate reindex endpoint, never by a
   *  user's search. Persists the result to the store (when one is configured) so the next
   *  cold instance can read it instead of crawling again, and warms this instance's own
   *  cache immediately. */
  public async rebuildIndex(collectionId: string): Promise<CollectionIndex> {
    const collection = this.collections.find(item => item.id === collectionId);
    if (!collection) throw new ApiError(404, "COLLECTION_NOT_FOUND", "Esta coleção não existe.");
    const index = await this.buildIndex(collection);
    if (this.store) await this.store.put(index);
    this.indexCache.set(collectionId, Promise.resolve(index));
    return index;
  }

  /** `breadcrumb` is the display trail - it always opens on the collection's own name, the
   *  same way open() shows it, whichever physical root an entry actually came from.
   *  `path` is the real, walkable id chain (starting at the actual root - the main one or
   *  one of sourceRootFolderIds) that the client must send back to open() or download a
   *  file. The two are tracked separately during the walk so every entry's collectionPath
   *  stays genuinely navigable, no matter how many physical roots the collection has. */
  private async buildIndex(collection: DriveCollection): Promise<CollectionIndex> {
    const results: CollectionIndexEntry[] = [];
    const visitedFolders = new Set<string>();
    const seenFiles = new Set<string>();
    const root = [{ id: collection.rootFolderId, name: collection.name }];
    const walk = async (folderId: string, breadcrumb: readonly { id: string; name: string }[], path: readonly string[]): Promise<void> => {
      if (visitedFolders.has(folderId) || visitedFolders.size >= DriveCollectionService.maxIndexedFolders) return;
      visitedFolders.add(folderId);
      const children = await this.entries(folderId, collection);
      const subfolders: Array<{ id: string; name: string }> = [];
      for (const child of children) {
        if (child.kind === "folder") { subfolders.push({ id: child.id, name: child.name }); continue; }
        if (seenFiles.has(child.id)) continue;
        seenFiles.add(child.id);
        results.push({ entry: { ...child, parentId: folderId, collectionPath: [...path, child.id] }, breadcrumb });
      }
      await Promise.all(subfolders.map(sub => walk(sub.id, [...breadcrumb, sub], [...path, sub.id])));
    };
    await Promise.all(this.rootIds(collection).map(rootId => walk(rootId, root, [rootId])));
    return { collectionId: collection.id, entries: results };
  }

  public async open(collectionId: string, folderId?: string, path?: readonly string[]): Promise<DriveFolderListing> {
    const collection = this.collections.find(item => item.id === collectionId);
    if (!collection) throw new ApiError(404, "COLLECTION_NOT_FOUND", "Esta coleção não existe.");
    const target = folderId?.trim() || collection.rootFolderId;
    const rootIds = this.rootIds(collection);
    if (target === collection.rootFolderId && !folderId) {
      const pages = await Promise.all(rootIds.map(async sourceRootId => ({ sourceRootId, entries: await this.entries(sourceRootId, collection) })));
      const seen = new Set<string>();
      const entries = sortEntries(pages.flatMap(page => page.entries
        .filter(entry => !seen.has(entry.id) && Boolean(seen.add(entry.id)))
        .map(entry => ({ ...entry, parentId: page.sourceRootId, collectionPath: [page.sourceRootId, entry.id] }))));
      return { collectionId: collection.id, folderId: collection.rootFolderId,
        breadcrumb: [{ id: collection.rootFolderId, name: collection.name }], entries,
        warnings: [...this.browser.warnings], sourceRootId: collection.rootFolderId };
    }
    const steps = this.normalizePath(collection, target, path);
    const breadcrumb = await this.breadcrumb(collection, steps);
    const entries = sortEntries(await this.entries(target, collection)).map(entry => ({
      ...entry, parentId: target, collectionPath: [...steps, entry.id],
    }));
    return { collectionId: collection.id, folderId: target, breadcrumb, entries,
      warnings: [...this.browser.warnings], sourceRootId: steps[0] };

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
  private async breadcrumb(collection: DriveCollection, steps: readonly string[]): Promise<readonly { id: string; name: string }[]> {
    const trail = [{ id: collection.rootFolderId, name: collection.name }];
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
    if (!this.rootIds(collection).includes(steps[0]!)) throw new ApiError(404, "COLLECTION_FOLDER_NOT_FOUND", "Esta pasta não pertence a esta coleção.");
    if (steps[steps.length - 1] !== folderId) throw new ApiError(404, "COLLECTION_FOLDER_NOT_FOUND", "Esta pasta não pertence a esta coleção.");
    if (steps.length > DriveCollectionService.maxDepth) throw new ApiError(400, "COLLECTION_PATH_TOO_DEEP", "Caminho longo demais.");
    if (new Set(steps).size !== steps.length) throw new ApiError(400, "COLLECTION_PATH_INVALID", "Caminho inválido.");
    return steps;
  }

  private rootIds(collection: DriveCollection): readonly string[] {
    return [...new Set([collection.rootFolderId, ...(collection.sourceRootFolderIds ?? [])])];
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
