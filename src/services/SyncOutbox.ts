import type { Book } from "../models/Book";
import type { Genre } from "../models/Genre";
import type { ReadingReview } from "../models/ReadingReview";
import type { UserLibraryPreferences } from "../repositories/UserLibraryPreferencesRepository";
import { IndexedDbService, STORE_NAMES } from "./IndexedDbService";
import type { AccountPersistenceService } from "./AccountPersistenceService";

export type SyncOutboxKind = "book" | "deleteBook" | "preferences";
export interface SyncOutboxEntry { id: string; userId: string; kind: SyncOutboxKind; payload: unknown; createdAt: string; attempts: number; lastError?: string; }

export class SyncOutboxRepository {
  public constructor(private readonly database: IndexedDbService) {}
  public save(entry: SyncOutboxEntry): Promise<void> { return this.database.request(STORE_NAMES.syncOutbox, "readwrite", store => store.put(entry)).then(() => undefined); }
  public list(userId: string): Promise<SyncOutboxEntry[]> { return this.database.request<SyncOutboxEntry[]>(STORE_NAMES.syncOutbox, "readonly", store => store.index("userCreated").getAll(IDBKeyRange.bound([userId, ""], [userId, "\uffff"]))); }
  public delete(id: string): Promise<void> { return this.database.request(STORE_NAMES.syncOutbox, "readwrite", store => store.delete(id)).then(() => undefined); }
}

export class SyncOutbox {
  private flushing: Promise<void> | null = null;
  public constructor(private readonly repository: SyncOutboxRepository, private readonly account: AccountPersistenceService, private readonly userId: string) {}
  public async enqueueBook(book: Book, genre: Genre | undefined, review: ReadingReview | null | undefined): Promise<void> { await this.enqueue("book", { book, genre, review }); }
  public async enqueueDelete(bookId: string): Promise<void> { await this.enqueue("deleteBook", { bookId }); }
  public async enqueuePreferences(preferences: UserLibraryPreferences): Promise<void> { await this.enqueue("preferences", { preferences }); }
  public async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushEntries().finally(() => { this.flushing = null; });
    return this.flushing;
  }
  private async enqueue(kind: SyncOutboxKind, payload: unknown): Promise<void> {
    await this.repository.save({ id: crypto.randomUUID(), userId: this.userId, kind, payload, createdAt: new Date().toISOString(), attempts: 0 });
  }
  private async flushEntries(): Promise<void> {
    for (const entry of await this.repository.list(this.userId)) {
      try {
        const payload = entry.payload as { book?: Book; genre?: Genre; review?: ReadingReview | null; bookId?: string; preferences?: UserLibraryPreferences };
        if (entry.kind === "book" && payload.book) await this.account.saveBook(payload.book, payload.genre, payload.review);
        else if (entry.kind === "deleteBook" && payload.bookId) await this.account.deleteBook(payload.bookId);
        else if (entry.kind === "preferences" && payload.preferences) await this.account.savePreferences(payload.preferences);
        await this.repository.delete(entry.id);
      } catch (error) {
        await this.repository.save({ ...entry, attempts: entry.attempts + 1, lastError: error instanceof Error ? error.message : "SYNC_FAILED" });
        break;
      }
    }
  }
}