import type { ComicPage, ComicPageAsset } from "./ComicInteractionTypes";
import type { ComicConversionResult } from "./ComicConverter";

export interface ComicCachedPage { page: ComicPage; asset: ComicPageAsset; }
export interface ComicConversionCache {
  page(key: string, index: number): Promise<ComicCachedPage | undefined>;
  savePage(key: string, value: ComicCachedPage): Promise<void>;
  completed(key: string): Promise<ComicConversionResult | undefined>;
  complete(key: string, result: ComicConversionResult): Promise<void>;
}

/** Separate database: comic conversion never migrates the book reader's storage. */
export class IndexedDbComicConversionCache implements ComicConversionCache {
  private database?: Promise<IDBDatabase>;
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("lumeo-comic-conversions", 1);
      request.onupgradeneeded = () => { request.result.createObjectStore("pages"); request.result.createObjectStore("completed"); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  private async request<T>(store: string, key: string, value?: T): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, value === undefined ? "readonly" : "readwrite");
      const objectStore = transaction.objectStore(store);
      const request = value === undefined ? objectStore.get(key) : objectStore.put(value, key);
      transaction.oncomplete = () => resolve(value ?? request.result as T | undefined);
      transaction.onabort = transaction.onerror = () => reject(transaction.error ?? request.error);
    });
  }
  public page(key: string, index: number): Promise<ComicCachedPage | undefined> { return this.request("pages", `${key}:${index}`); }
  public async savePage(key: string, value: ComicCachedPage): Promise<void> { await this.request("pages", `${key}:${value.page.index}`, value); }
  public completed(key: string): Promise<ComicConversionResult | undefined> { return this.request("completed", key); }
  public async completedForSource(key: string): Promise<ComicConversionResult | undefined> {
    const db = await this.open();
    const prefix = key.slice(0, key.lastIndexOf(":") + 1);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("completed", "readonly");
      const request = transaction.objectStore("completed").openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
      request.onsuccess = () => resolve(request.result?.value as ComicConversionResult | undefined);
      request.onerror = () => reject(request.error);
    });
  }
  public async complete(key: string, result: ComicConversionResult): Promise<void> { await this.request("completed", key, result); }
}
