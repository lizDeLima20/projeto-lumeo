import type { SupabaseClient } from "@supabase/supabase-js";

export interface PersistedGenre { id: string; name: string; }
export interface PersistedPreferences { onboardingCompleted: boolean; theme: "light" | "dark"; genres: readonly PersistedGenre[]; }
export interface PersistedLibraryBook { bookId: string; metadata: Record<string, unknown>; updatedAt: string; }
export interface PersistedUserState { preferences: PersistedPreferences | null; books: readonly PersistedLibraryBook[]; }

export interface UserPersistenceStore {
  getState(userId: string): Promise<PersistedUserState>;
  savePreferences(userId: string, preferences: PersistedPreferences): Promise<void>;
  saveBook(userId: string, book: PersistedLibraryBook): Promise<PersistedLibraryBook>;
  deleteBook(userId: string, bookId: string): Promise<void>;
}

/** Server-only account metadata store. It never receives or stores book bytes. */
export class UserPersistenceRepository implements UserPersistenceStore {
  public constructor(private readonly database: SupabaseClient) {}

  public async getState(userId: string): Promise<PersistedUserState> {
    const [preferencesResult, booksResult] = await Promise.all([
      this.database.from("user_preferences").select("onboarding_completed,theme,genres").eq("user_id", userId).maybeSingle(),
      // `updated_at` is present in the already-published schema.  The source
      // timestamp travels in metadata so a web deploy stays compatible until
      // the optional sync migration is applied.
      this.database.from("user_library_books").select("book_id,metadata,updated_at").eq("user_id", userId).order("updated_at", { ascending: false }),
    ]);
    if (preferencesResult.error) throw preferencesResult.error;
    if (booksResult.error) throw booksResult.error;
    const preferences = preferencesResult.data
      ? {
          onboardingCompleted: Boolean(preferencesResult.data.onboarding_completed),
          theme: preferencesResult.data.theme === "dark" ? "dark" as const : "light" as const,
          genres: UserPersistenceRepository.genres(preferencesResult.data.genres),
        }
      : null;
    const books = (booksResult.data ?? []).flatMap((row): PersistedLibraryBook[] => {
      if (!row || typeof row.book_id !== "string" || !row.metadata || typeof row.metadata !== "object" || Array.isArray(row.metadata)) return [];
      const metadata = row.metadata as Record<string, unknown>;
      return [{
        bookId: row.book_id,
        metadata,
        updatedAt: UserPersistenceRepository.metadataTimestamp(metadata, row.updated_at),
      }];
    });
    return { preferences, books };
  }

  public async savePreferences(userId: string, preferences: PersistedPreferences): Promise<void> {
    const { error } = await this.database.from("user_preferences").upsert({
      user_id: userId,
      onboarding_completed: preferences.onboardingCompleted,
      theme: preferences.theme,
      genres: preferences.genres,
    }, { onConflict: "user_id" });
    if (error) throw error;
  }

  public async saveBook(userId: string, book: PersistedLibraryBook): Promise<PersistedLibraryBook> {
    const incoming = UserPersistenceRepository.safeTimestamp(book.updatedAt);
    const existing = await this.database.from("user_library_books").select("book_id,metadata,updated_at").eq("user_id", userId).eq("book_id", book.bookId).maybeSingle();
    if (existing.error) throw existing.error;
    const existingMetadata = existing.data?.metadata && typeof existing.data.metadata === "object" && !Array.isArray(existing.data.metadata)
      ? existing.data.metadata as Record<string, unknown>
      : null;
    const existingUpdatedAt = existingMetadata
      ? UserPersistenceRepository.metadataTimestamp(existingMetadata, existing.data?.updated_at)
      : null;
    // Last-write-wins is based on the source record timestamp, not request order.
    // A device that was offline cannot overwrite progress saved later elsewhere.
    if (existing.data && existingUpdatedAt && Date.parse(existingUpdatedAt) > Date.parse(incoming)) {
      return { bookId: existing.data.book_id, metadata: existingMetadata!, updatedAt: existingUpdatedAt };
    }
    const metadata = { ...book.metadata, updatedAt: incoming };
    const { data, error } = await this.database.from("user_library_books").upsert({ user_id: userId, book_id: book.bookId, metadata }, { onConflict: "user_id,book_id" }).select("book_id,metadata,updated_at").single();
    if (error) throw error;
    return {
      bookId: data.book_id,
      metadata: data.metadata as Record<string, unknown>,
      updatedAt: UserPersistenceRepository.metadataTimestamp(data.metadata as Record<string, unknown>, data.updated_at),
    };
  }

  public async deleteBook(userId: string, bookId: string): Promise<void> {
    const { error } = await this.database.from("user_library_books").delete().eq("user_id", userId).eq("book_id", bookId);
    if (error) throw error;
  }

  private static genres(value: unknown): readonly PersistedGenre[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((genre): PersistedGenre[] => {
      if (!genre || typeof genre !== "object") return [];
      const row = genre as Record<string, unknown>; const id = row.id; const name = row.name;
      return typeof id === "string" && typeof name === "string" ? [{ id, name }] : [];
    });
  }
  private static safeTimestamp(value: string): string { return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : new Date().toISOString(); }
  private static metadataTimestamp(metadata: Record<string, unknown>, fallback: unknown): string {
    const candidate = metadata.updatedAt;
    if (typeof candidate === "string" && Number.isFinite(Date.parse(candidate))) return new Date(candidate).toISOString();
    return typeof fallback === "string" && Number.isFinite(Date.parse(fallback)) ? new Date(fallback).toISOString() : new Date(0).toISOString();
  }
}
