import { IndexedDbService, STORE_NAMES } from "../services/IndexedDbService";
import type { StorageAdapter } from "../services/StorageService";
/** Uses the existing per-user local database. Errors are never hidden in RAM. */
export class ExternalLibraryStorage implements StorageAdapter {
  public constructor(private readonly database: IndexedDbService) {}
  public async load<T>(key: string): Promise<T | null> {
    const row = await this.database.request<{ key: string; value: T } | undefined>(STORE_NAMES.librarySettings, "readonly", store => store.get(key));
    return row?.value ?? null;
  }
  public async save<T>(key: string, value: T): Promise<void> {
    await this.database.request(STORE_NAMES.librarySettings, "readwrite", store => store.put({ key, value }));
  }
  public async remove(key: string): Promise<void> {
    await this.database.request(STORE_NAMES.librarySettings, "readwrite", store => store.delete(key));
  }
}
