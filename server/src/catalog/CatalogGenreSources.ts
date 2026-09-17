import type { CatalogGenreSource, CatalogSourceStore } from "./CatalogSourceRepository.js";
import type { CatalogSourceConfig } from "./types.js";

/** Stable genre id used by the API filter: "Ficção científica" -> "ficcao-cientifica". */
export function catalogGenreId(genre: string): string {
  return genre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "sem-genero";
}

/** A registered genre folder is an ordinary structured source whose books all take its genre. */
export function genreSourceConfig(source: CatalogGenreSource, priority = 100): CatalogSourceConfig {
  return { sourceId: `genre-${source.id}`, locale: source.locale, folderId: source.folderId, mode: "structured", enabled: source.enabled, priority, genre: source.genre };
}

/**
 * Every catalogue source in effect: the environment sources plus the genre folders saved
 * through the admin screen. Saved folders are re-read at most once a minute, so a new
 * genre appears without a deploy; a store outage keeps the environment sources working.
 */
export class ConfiguredCatalogSources {
  private cache: { expiresAt: number; sources: readonly CatalogSourceConfig[] } | null = null;
  public constructor(private readonly base: readonly CatalogSourceConfig[], private readonly store: CatalogSourceStore | null, private readonly ttlMs = 60_000) {}

  public async all(): Promise<readonly CatalogSourceConfig[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.sources;
    let sources = this.base;
    if (this.store) {
      try {
        const known = new Set(this.base.map((source) => source.sourceId));
        const genres = (await this.store.list()).map((source, index) => genreSourceConfig(source, 100 + index)).filter((source) => !known.has(source.sourceId));
        sources = [...this.base, ...genres];
      } catch (error) {
        console.warn(JSON.stringify({ event: "CATALOG_SOURCE_STORE_UNAVAILABLE", code: error instanceof Error ? ("code" in error ? String((error as { code: unknown }).code) : error.message.slice(0, 80)) : "UNKNOWN" }));
        // Retry soon rather than holding a partial list for the full minute.
        this.cache = { expiresAt: Date.now() + Math.min(this.ttlMs, 10_000), sources };
        return sources;
      }
    }
    this.cache = { expiresAt: Date.now() + this.ttlMs, sources };
    return sources;
  }

  public invalidate(): void { this.cache = null; }
}
