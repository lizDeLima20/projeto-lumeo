import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../errors/ApiError.js";

/** A genre folder registered through the admin screen: name and Drive folder only. */
export interface CatalogGenreSource {
  id: string;
  genre: string;
  driveFolderUrl: string;
  folderId: string;
  locale: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface CatalogGenreSourceInput { genre: string; driveFolderUrl: string; folderId: string; enabled: boolean; }

export interface CatalogSourceStore {
  list(): Promise<readonly CatalogGenreSource[]>;
  get(id: string): Promise<CatalogGenreSource | null>;
  create(input: CatalogGenreSourceInput, userId: string): Promise<CatalogGenreSource>;
  update(id: string, input: Partial<CatalogGenreSourceInput>): Promise<CatalogGenreSource>;
  remove(id: string): Promise<void>;
}

type Row = { id: string; genre: string; drive_folder_url: string; folder_id: string; locale: string; enabled: boolean; created_at: string; updated_at: string };

/** Persistent list of catalogue genre folders. Metadata only; no book or cover bytes. */
export class CatalogSourceRepository implements CatalogSourceStore {
  public constructor(private readonly database: SupabaseClient) {}
  public async list(): Promise<readonly CatalogGenreSource[]> {
    const { data, error } = await this.database.from("catalog_sources").select("*").order("created_at", { ascending: true });
    if (error) throw this.failure(error);
    return (data ?? []).map((row) => this.map(row as Row));
  }
  public async get(id: string): Promise<CatalogGenreSource | null> {
    const { data, error } = await this.database.from("catalog_sources").select("*").eq("id", id).maybeSingle();
    if (error) throw this.failure(error);
    return data ? this.map(data as Row) : null;
  }
  public async create(input: CatalogGenreSourceInput, userId: string): Promise<CatalogGenreSource> {
    const { data, error } = await this.database.from("catalog_sources").insert({ genre: input.genre, drive_folder_url: input.driveFolderUrl, folder_id: input.folderId, enabled: input.enabled, created_by: userId }).select("*").single();
    if (error) throw this.failure(error);
    return this.map(data as Row);
  }
  public async update(id: string, input: Partial<CatalogGenreSourceInput>): Promise<CatalogGenreSource> {
    const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.genre !== undefined) changes.genre = input.genre;
    if (input.driveFolderUrl !== undefined) changes.drive_folder_url = input.driveFolderUrl;
    if (input.folderId !== undefined) changes.folder_id = input.folderId;
    if (input.enabled !== undefined) changes.enabled = input.enabled;
    const { data, error } = await this.database.from("catalog_sources").update(changes).eq("id", id).select("*").maybeSingle();
    if (error) throw this.failure(error);
    if (!data) throw new ApiError(404, "CATALOG_SOURCE_NOT_FOUND", "Fonte do catálogo não encontrada.");
    return this.map(data as Row);
  }
  public async remove(id: string): Promise<void> {
    const { error } = await this.database.from("catalog_sources").delete().eq("id", id);
    if (error) throw this.failure(error);
  }
  private map(row: Row): CatalogGenreSource { return { id: row.id, genre: row.genre, driveFolderUrl: row.drive_folder_url, folderId: row.folder_id, locale: row.locale, enabled: row.enabled, createdAt: row.created_at, updatedAt: row.updated_at }; }
  private failure(error: { code?: string; message?: string }): ApiError {
    if (error.code === "23505") return new ApiError(409, "CATALOG_SOURCE_DUPLICATE", "Este gênero ou esta pasta já está cadastrado.");
    if (error.code === "42P01" || error.code === "PGRST205") return new ApiError(503, "CATALOG_SOURCES_NOT_MIGRATED", "A tabela de fontes do catálogo ainda não foi criada.");
    if (error.code === "22P02") return new ApiError(404, "CATALOG_SOURCE_NOT_FOUND", "Fonte do catálogo não encontrada.");
    return new ApiError(503, "CATALOG_SOURCES_UNAVAILABLE", "Não foi possível ler as fontes do catálogo.");
  }
}
