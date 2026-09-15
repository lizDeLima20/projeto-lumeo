import type { Book } from "../models/Book";
import type { Genre } from "../models/Genre";
import type { ApiClient } from "./ApiClient";
import type { UserLibraryPreferences } from "../repositories/UserLibraryPreferencesRepository";

export interface RemoteLibraryBook { bookId: string; metadata: Record<string, unknown>; }
export interface RemoteAccountState { preferences: UserLibraryPreferences | null; books: readonly RemoteLibraryBook[]; }

/** Mirrors lightweight account metadata. Offline book bytes never leave the device. */
export class AccountPersistenceService {
  public constructor(private readonly api: ApiClient) {}
  public load(): Promise<RemoteAccountState> { return this.api.get("/user-state"); }
  public savePreferences(preferences: UserLibraryPreferences): Promise<void> { return this.api.post("/user-state/preferences", { preferences }).then(() => undefined); }
  public saveBook(book: Book, genre: Genre | undefined): Promise<void> {
    return this.api.post("/user-state/library", { book: { bookId: book.id, metadata: this.metadata(book, genre) } }).then(() => undefined);
  }
  public deleteBook(bookId: string): Promise<void> { return this.api.post("/user-state/library/delete", { bookId }).then(() => undefined); }

  private metadata(book: Book, genre: Genre | undefined): Record<string, unknown> {
    // Covers produced from local PDFs are data URLs and can be very large. The
    // durable record keeps only safe metadata; the local library retains cover bytes.
    const cover = /^https:\/\//u.test(book.cover) ? book.cover : null;
    return {
      title: book.title, author: book.author, genreId: book.genreId, genreName: genre?.name ?? "Sem gênero",
      fileType: book.fileType, fileName: book.fileName, fileSize: book.fileSize, mimeType: book.mimeType,
      readingStatus: book.readingStatus, progressPercent: book.progressPercent ?? 0, currentLocation: book.currentLocation ?? null,
      collectionId: book.collectionId ?? null, volume: book.volume ?? null, series: book.series ?? null,
      description: book.description ?? null, publicationYear: book.publicationYear ?? null,
      catalogBookId: book.catalogBookId ?? null, source: book.source, cover,
      addedAt: book.createdAt.toISOString(), updatedAt: book.updatedAt.toISOString(),
    };
  }
}
