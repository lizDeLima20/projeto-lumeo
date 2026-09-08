import type { Book } from "../models/Book";
import { CacheCleanupManager } from "../pwa/CacheCleanupManager";

export interface StorageEstimateLike { usage?: number; quota?: number; }
export interface StorageCategoryUsage {
  books: number;
  cache: number;
  studyData: number;
  preferences: number;
}
export interface LocalStorageReport extends StorageEstimateLike {
  available?: number;
  lowSpace: boolean;
  categories: StorageCategoryUsage;
  largestBooks: { id: string; title: string; bytes: number }[];
}

export class LocalStorageManager {
  public constructor(
    private readonly storageManager: Pick<StorageManager, "estimate"> | undefined = typeof navigator === "undefined" ? undefined : navigator.storage,
    private readonly cacheCleanup = new CacheCleanupManager(),
  ) {}

  public async report(books: readonly Book[], studyBytes = 0, cacheBytes = 0, preferenceBytes = 0): Promise<LocalStorageReport> {
    const estimate = await this.estimate();
    const booksBytes = books.reduce((sum, book) => sum + book.fileSize, 0);
    const available = estimate.quota !== undefined && estimate.usage !== undefined ? Math.max(0, estimate.quota - estimate.usage) : undefined;
    return {
      usage: estimate.usage,
      quota: estimate.quota,
      available,
      lowSpace: this.isLowSpace(estimate),
      categories: { books: booksBytes, cache: cacheBytes, studyData: studyBytes, preferences: preferenceBytes },
      largestBooks: [...books].sort((a, b) => b.fileSize - a.fileSize).slice(0, 5).map((book) => ({ id: book.id, title: book.title, bytes: book.fileSize })),
    };
  }

  public async cleanupTemporary(): Promise<string[]> {
    return this.cacheCleanup.cleanupTemporary();
  }

  public async estimate(): Promise<StorageEstimateLike> {
    return await this.storageManager?.estimate?.() ?? {};
  }

  public isLowSpace(estimate: StorageEstimateLike): boolean {
    if (estimate.quota === undefined || estimate.usage === undefined || estimate.quota <= 0) return false;
    return estimate.usage / estimate.quota >= 0.9;
  }
}
