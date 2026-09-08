import { IndexedDbService, STORE_NAMES } from "../services/IndexedDbService";

interface StoredFile { bookId: string; blob: Blob; }
export class BookFileRepository {
  public constructor(private readonly database: IndexedDbService) {}
  public async save(bookId: string, file: Blob): Promise<void> {
    await this.database.request(STORE_NAMES.files, "readwrite", (store) => store.put({ bookId, blob: file } satisfies StoredFile));
  }
  public async get(bookId: string): Promise<Blob | null> {
    const row = await this.database.request<StoredFile | undefined>(STORE_NAMES.files, "readonly", (store) => store.get(bookId));
    return row?.blob ?? null;
  }
  public async delete(bookId: string): Promise<void> {
    await this.database.request(STORE_NAMES.files, "readwrite", (store) => store.delete(bookId));
  }
  public async exists(bookId: string): Promise<boolean> {
    return (await this.database.request<IDBValidKey | undefined>(STORE_NAMES.files, "readonly", (store) => store.getKey(bookId))) !== undefined;
  }
}
