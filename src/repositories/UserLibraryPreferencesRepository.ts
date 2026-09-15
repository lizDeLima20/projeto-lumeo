import { IndexedDbService, STORE_NAMES } from "../services/IndexedDbService";
import type { Genre } from "../models/Genre";

export interface UserLibraryPreferences {
  onboardingCompleted: boolean;
  theme: "light" | "dark";
  genres: readonly { id: string; name: string }[];
}

/** Stored in the user-namespaced library database, never cleared by logout. */
export class UserLibraryPreferencesRepository {
  private static readonly KEY = "account-preferences";
  public constructor(private readonly database: IndexedDbService) {}
  public async load(): Promise<UserLibraryPreferences | null> {
    const row = await this.database.request<{ key: string; value?: unknown } | undefined>(STORE_NAMES.librarySettings, "readonly", store => store.get(UserLibraryPreferencesRepository.KEY));
    const value = row?.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const data = value as Partial<UserLibraryPreferences>;
    if (typeof data.onboardingCompleted !== "boolean" || (data.theme !== "light" && data.theme !== "dark") || !Array.isArray(data.genres)) return null;
    const genres = data.genres.flatMap((genre): Array<{ id: string; name: string }> => genre && typeof genre.id === "string" && typeof genre.name === "string" ? [{ id: genre.id, name: genre.name }] : []);
    return { onboardingCompleted: data.onboardingCompleted, theme: data.theme, genres };
  }
  public async save(preferences: UserLibraryPreferences): Promise<void> {
    await this.database.request(STORE_NAMES.librarySettings, "readwrite", store => store.put({ key: UserLibraryPreferencesRepository.KEY, value: preferences }));
  }
  public fromState(onboardingCompleted: boolean, theme: "light" | "dark", genres: readonly Genre[]): UserLibraryPreferences {
    return { onboardingCompleted, theme, genres: genres.map(genre => ({ id: genre.id, name: genre.name })) };
  }
}
