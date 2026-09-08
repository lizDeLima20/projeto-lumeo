import { IndexedDbService, STORE_NAMES } from "../services/IndexedDbService";

export interface ReadingProgress {
  bookId: string;
  currentPage: number;
  totalPages: number;
  currentLocation?: string;
  progressPercent: number;
  updatedAt: string;
}
export class ReadingProgressRepository {
  public constructor(private readonly database: IndexedDbService) {}
  public async save(progress: ReadingProgress): Promise<void> {
    await this.database.request(STORE_NAMES.progress, "readwrite", (store) => store.put(progress));
  }
  public async get(bookId: string): Promise<ReadingProgress | null> {
    return (await this.database.request<ReadingProgress | undefined>(STORE_NAMES.progress, "readonly", (store) => store.get(bookId))) ?? null;
  }
  public async delete(bookId: string): Promise<void> {
    await this.database.request(STORE_NAMES.progress, "readwrite", (store) => store.delete(bookId));
  }
}
