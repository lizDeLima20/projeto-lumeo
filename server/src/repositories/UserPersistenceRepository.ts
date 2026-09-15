import type { SupabaseClient } from "@supabase/supabase-js";

export interface PersistedGenre { id: string; name: string; }
export interface PersistedPreferences { onboardingCompleted: boolean; theme: "light" | "dark"; genres: readonly PersistedGenre[]; }
export interface PersistedLibraryBook { bookId: string; metadata: Record<string, unknown>; }
export interface PersistedUserState { preferences: PersistedPreferences | null; books: readonly PersistedLibraryBook[]; }

export interface UserPersistenceStore {
  getState(userId: string): Promise<PersistedUserState>;
  savePreferences(userId: string, preferences: PersistedPreferences): Promise<void>;
  saveBook(userId: string, book: PersistedLibraryBook): Promise<void>;
  deleteBook(userId: string, bookId: string): Promise<void>;
}

/** Server-only account metadata store. It never receives or stores book bytes. */
export class UserPersistenceRepository implements UserPersistenceStore {
  public constructor(private readonly database: SupabaseClient) {}

  public async getState(userId: string): Promise<PersistedUserState> {
    const [preferencesResult, booksResult] = await Promise.all([
      this.database.from("user_preferences").select("onboarding_completed,theme,genres").eq("user_id", userId).maybeSingle(),
      this.database.from("user_library_books").select("book_id,metadata").eq("user_id", userId).order("updated_at", { ascending: false }),
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
      return [{ bookId: row.book_id, metadata: row.metadata as Record<string, unknown> }];
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

  public async saveBook(userId: string, book: PersistedLibraryBook): Promise<void> {
    const { error } = await this.database.from("user_library_books").upsert({ user_id: userId, book_id: book.bookId, metadata: book.metadata }, { onConflict: "user_id,book_id" });
    if (error) throw error;
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
}
