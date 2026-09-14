import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogBookRecord, CatalogPage, CatalogQuery } from "./types.js";

export interface CatalogStore {
  list(query: CatalogQuery): Promise<CatalogPage>;
  getActive(bookId: string): Promise<CatalogBookRecord | null>;
  getAnyByDriveFileId(storageAccountId: string, driveFileId: string): Promise<CatalogBookRecord | null>;
  getAnyBySha256(sha256: string): Promise<CatalogBookRecord | null>;
  save(book: CatalogBookRecord): Promise<void>;
  markUnavailableMissingFrom(storageAccountId: string, driveFileIds: ReadonlySet<string>): Promise<number>;
  isAdmin(userId: string): Promise<boolean>;
}

type Row = {
  book_id: string; title: string; author: string; genre_id: string; genre_name: string; cover_url: string | null; description: string | null;
  format: "pdf" | "epub"; source_file_name?: string | null; file_size: number | null; drive_file_id: string; storage_account_id: string; sha256: string | null;
  volume: string | null; collection: string | null; language: string | null; created_at: string; updated_at: string; status: CatalogBookRecord["status"];
};

export class CatalogRepository implements CatalogStore {
  public constructor(private readonly database: SupabaseClient) {}
  public async list(query: CatalogQuery): Promise<CatalogPage> {
    let request = this.database.from("catalog_books").select("*", { count: "exact" }).eq("status", "ACTIVE").order("updated_at", { ascending: false }).order("book_id", { ascending: true });
    if (query.genreId) request = request.eq("genre_id", query.genreId);
    if (query.author) request = request.ilike("author", `%${this.escapeLike(query.author)}%`);
    if (query.format) request = request.eq("format", query.format);
    if (query.collection) request = request.ilike("collection", `%${this.escapeLike(query.collection)}%`);
    if (query.query) {
      const needle = this.escapeLike(query.query);
      request = request.or(`title.ilike.%${needle}%,author.ilike.%${needle}%,genre_name.ilike.%${needle}%,collection.ilike.%${needle}%`);
    }
    const { data, error } = await request.range(query.offset, query.offset + query.limit);
    if (error) throw error;
    const rows = (data ?? []).map((row) => this.map(row as Row));
    const items = rows.slice(0, query.limit);
    return { items, nextCursor: rows.length > query.limit ? String(query.offset + query.limit) : null };
  }
  public async getActive(bookId: string): Promise<CatalogBookRecord | null> {
    const { data, error } = await this.database.from("catalog_books").select("*").eq("book_id", bookId).eq("status", "ACTIVE").maybeSingle();
    if (error) throw error; return data ? this.map(data as Row) : null;
  }
  public async getAnyByDriveFileId(storageAccountId: string, driveFileId: string): Promise<CatalogBookRecord | null> {
    const { data, error } = await this.database.from("catalog_books").select("*").eq("storage_account_id", storageAccountId).eq("drive_file_id", driveFileId).maybeSingle();
    if (error) throw error; return data ? this.map(data as Row) : null;
  }
  public async getAnyBySha256(sha256: string): Promise<CatalogBookRecord | null> {
    const { data, error } = await this.database.from("catalog_books").select("*").eq("sha256", sha256).maybeSingle();
    if (error) throw error; return data ? this.map(data as Row) : null;
  }
  public async save(book: CatalogBookRecord): Promise<void> {
    const { error } = await this.database.from("catalog_books").upsert(this.row(book), { onConflict: "book_id" });
    if (error) throw error;
  }
  public async markUnavailableMissingFrom(storageAccountId: string, driveFileIds: ReadonlySet<string>): Promise<number> {
    const { data, error } = await this.database.from("catalog_books").select("book_id,drive_file_id").eq("storage_account_id", storageAccountId).eq("status", "ACTIVE");
    if (error) throw error;
    const missing = (data ?? []).filter((row: { drive_file_id: string }) => !driveFileIds.has(row.drive_file_id)).map((row: { book_id: string }) => row.book_id);
    if (!missing.length) return 0;
    const { error: updateError } = await this.database.from("catalog_books").update({ status: "UNAVAILABLE", updated_at: new Date().toISOString() }).in("book_id", missing);
    if (updateError) throw updateError;
    return missing.length;
  }
  public async isAdmin(userId: string): Promise<boolean> {
    const { data, error } = await this.database.from("profiles").select("is_admin").eq("user_id", userId).maybeSingle();
    if (error) throw error; return data?.is_admin === true;
  }
  private map(row: Row): CatalogBookRecord { return { bookId: row.book_id, title: row.title, author: row.author, genreId: row.genre_id, genreName: row.genre_name, coverUrl: row.cover_url, description: row.description, format: row.format, sourceFileName: row.source_file_name ?? null, fileSize: row.file_size, driveFileId: row.drive_file_id, storageAccountId: row.storage_account_id, sha256: row.sha256, volume: row.volume, collection: row.collection, language: row.language, createdAt: row.created_at, updatedAt: row.updated_at, status: row.status }; }
  private row(book: CatalogBookRecord): Row { return { book_id: book.bookId, title: book.title, author: book.author, genre_id: book.genreId, genre_name: book.genreName, cover_url: book.coverUrl, description: book.description, format: book.format, source_file_name: book.sourceFileName ?? null, file_size: book.fileSize, drive_file_id: book.driveFileId, storage_account_id: book.storageAccountId, sha256: book.sha256, volume: book.volume, collection: book.collection, language: book.language, created_at: book.createdAt, updated_at: book.updatedAt, status: book.status }; }
  private escapeLike(value: string): string { return value.replace(/[,%_()]/g, " ").trim().slice(0, 120); }
}
