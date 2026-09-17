import { ApiError } from "../errors/ApiError.js";
import { ConfiguredCatalogSources, genreSourceConfig } from "./CatalogGenreSources.js";
import type { CatalogSourceRegistry } from "./CatalogSourceRegistry.js";
import type { CatalogGenreSource, CatalogSourceStore } from "./CatalogSourceRepository.js";
import { GoogleDriveFolderLink } from "./GoogleDriveFolderLink.js";
import type { CatalogSourceInspection } from "./StructuredDriveCatalogProvider.js";
import type { CatalogSourceConfig } from "./types.js";

export type CatalogSourceHealth = "OK" | "EMPTY" | "NO_ACCESS" | "NO_CATALOG" | "INVALID_CATALOG" | "DISABLED";
/** The outcome of reading one folder, phrased for the admin screen rather than for logs. */
export interface CatalogSourceReport {
  folderId: string;
  folderFound: boolean;
  catalogFound: boolean;
  status: CatalogSourceHealth;
  inspection: CatalogSourceInspection | null;
}
export interface CatalogGenreSourceView extends CatalogGenreSource { report: CatalogSourceReport; }

interface InspectableProvider { inspect(): Promise<CatalogSourceInspection>; }

/** Registers genre folders by name and link, and tells whether each one can be read. */
export class CatalogSourceAdminService {
  public constructor(
    private readonly store: CatalogSourceStore,
    private readonly sources: ConfiguredCatalogSources,
    private readonly registry: CatalogSourceRegistry,
    private readonly isAdmin: (userId: string) => Promise<boolean>,
  ) {}

  public async list(userId: string): Promise<readonly CatalogGenreSourceView[]> {
    await this.assertAdmin(userId);
    const saved = await this.store.list();
    return Promise.all(saved.map(async (source) => ({ ...source, report: source.enabled ? await this.report(genreSourceConfig(source), false) : this.disabled(source.folderId) })));
  }

  public async create(userId: string, body: Record<string, unknown>): Promise<CatalogGenreSourceView> {
    await this.assertAdmin(userId);
    const genre = this.genre(body.genre), folderId = GoogleDriveFolderLink.folderId(this.link(body.driveFolderUrl));
    const saved = await this.store.create({ genre, folderId, driveFolderUrl: GoogleDriveFolderLink.canonicalUrl(folderId), enabled: body.enabled !== false }, userId);
    this.sources.invalidate();
    return { ...saved, report: saved.enabled ? await this.report(genreSourceConfig(saved), true) : this.disabled(folderId) };
  }

  public async update(userId: string, id: string, body: Record<string, unknown>): Promise<CatalogGenreSourceView> {
    await this.assertAdmin(userId);
    const folderId = body.driveFolderUrl === undefined ? undefined : GoogleDriveFolderLink.folderId(this.link(body.driveFolderUrl));
    const saved = await this.store.update(this.id(id), {
      ...(body.genre === undefined ? {} : { genre: this.genre(body.genre) }),
      ...(folderId === undefined ? {} : { folderId, driveFolderUrl: GoogleDriveFolderLink.canonicalUrl(folderId) }),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
    });
    this.sources.invalidate();
    return { ...saved, report: saved.enabled ? await this.report(genreSourceConfig(saved), true) : this.disabled(saved.folderId) };
  }

  public async remove(userId: string, id: string): Promise<void> {
    await this.assertAdmin(userId);
    await this.store.remove(this.id(id));
    this.sources.invalidate();
  }

  /** Reads a folder that may not be saved yet, bypassing every cache. */
  public async test(userId: string, body: Record<string, unknown>): Promise<CatalogSourceReport> {
    await this.assertAdmin(userId);
    const folderId = GoogleDriveFolderLink.folderId(this.link(body.driveFolderUrl));
    const genre = typeof body.genre === "string" && body.genre.trim() ? body.genre.trim() : "Teste";
    return this.report({ sourceId: "genre-test", locale: "pt-BR", folderId, mode: "structured", enabled: true, priority: 0, genre }, true);
  }

  public async testSaved(userId: string, id: string): Promise<CatalogSourceReport> {
    await this.assertAdmin(userId);
    const source = await this.store.get(this.id(id));
    if (!source) throw new ApiError(404, "CATALOG_SOURCE_NOT_FOUND", "Fonte do catálogo não encontrada.");
    return this.report(genreSourceConfig(source), true);
  }

  private async report(source: CatalogSourceConfig, fresh: boolean): Promise<CatalogSourceReport> {
    const provider = fresh ? this.registry.fresh(source) : await this.registry.provider(source);
    const empty = { folderId: source.folderId, inspection: null };
    if (!provider || !("inspect" in provider)) return { ...empty, folderFound: false, catalogFound: false, status: "NO_ACCESS" };
    try {
      const inspection = await (provider as unknown as InspectableProvider).inspect();
      return { folderId: source.folderId, folderFound: true, catalogFound: true, status: inspection.validBooks ? "OK" : "EMPTY", inspection };
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "";
      console.warn(JSON.stringify({ event: "CATALOG_SOURCE_TEST_FAILED", sourceId: source.sourceId, code: code || (error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN") }));
      if (code === "CATALOG_JSON_NOT_FOUND") return { ...empty, folderFound: true, catalogFound: false, status: "NO_CATALOG" };
      if (code === "CATALOG_SOURCE_INVALID") return { ...empty, folderFound: true, catalogFound: true, status: "INVALID_CATALOG" };
      return { ...empty, folderFound: false, catalogFound: false, status: "NO_ACCESS" };
    }
  }

  private disabled(folderId: string): CatalogSourceReport { return { folderId, folderFound: false, catalogFound: false, status: "DISABLED", inspection: null }; }
  private async assertAdmin(userId: string): Promise<void> {
    if (!await this.isAdmin(userId)) throw new ApiError(403, "CATALOG_ADMIN_REQUIRED", "Esta conta não pode administrar o catálogo.");
  }
  private link(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value.length > 500) throw new ApiError(422, "CATALOG_SOURCE_LINK_INVALID", "Link de pasta do Google Drive inválido.");
    return value;
  }
  private genre(value: unknown): string {
    const genre = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    // eslint-disable-next-line no-control-regex
    if (!genre || genre.length > 80 || /[\x00-\x1f<>]/.test(genre)) throw new ApiError(422, "CATALOG_SOURCE_GENRE_INVALID", "Informe um nome de gênero com até 80 caracteres.");
    return genre;
  }
  private id(value: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(value)) throw new ApiError(404, "CATALOG_SOURCE_NOT_FOUND", "Fonte do catálogo não encontrada.");
    return value;
  }
}
