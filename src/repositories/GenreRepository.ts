import { Genre } from "../models/Genre";
import { IndexedDbService, STORE_NAMES } from "../services/IndexedDbService";

interface StoredGenre { id: string; name: string; createdAt: string; isDefault: boolean; }
export class GenreRepository {
  public constructor(private readonly database: IndexedDbService) {}
  public async save(genre: Genre): Promise<void> {
    const row: StoredGenre = { ...genre, createdAt: genre.createdAt.toISOString() };
    await this.database.request(STORE_NAMES.genres, "readwrite", (store) => store.put(row));
  }
  public async getAll(): Promise<Genre[]> {
    const rows = await this.database.getAll<StoredGenre>(STORE_NAMES.genres);
    return rows.map((row) => new Genre(row.id, row.name, new Date(row.createdAt), row.isDefault));
  }
  public async delete(id: string): Promise<void> {
    await this.database.request(STORE_NAMES.genres, "readwrite", (store) => store.delete(id));
  }
}
