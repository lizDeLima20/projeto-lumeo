import type { CatalogSourceConfig } from "./types.js";

/**
 * Genre folders of the public catalogue. Each folder is named after its genre and holds
 * books/, covers/ and catalog.json; catalog.json is the only thing read from it.
 *
 * Adding a genre is one entry here: its name and the Drive folder ID.
 */
export const catalogGenreFolders: ReadonlyArray<{ genre: string; folderId: string }> = [
  { genre: "Artes e música", folderId: "1Yc2qLF5v5j163qtkqK0pnwKxL-uERNF0" },
  { genre: "Administração e economia", folderId: "10bXreEgmEAQGwjKW7-InnlX92YZ9VcNj" },
];

export function catalogGenreSourceId(genre: string): string {
  return `genre-${catalogGenreId(genre)}`;
}

/** Stable genre id used by the API filter: "Artes e música" -> "artes-e-musica". */
export function catalogGenreId(genre: string): string {
  return genre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "sem-genero";
}

/** Registered after the existing sources, sharing their registry and aggregation. A source
 * with the same sourceId in GOOGLE_CATALOG_SOURCES_JSON takes precedence. */
export function withCatalogGenreSources(sources: readonly CatalogSourceConfig[], folders = catalogGenreFolders): readonly CatalogSourceConfig[] {
  const known = new Set(sources.map((source) => source.sourceId));
  const genres = folders.flatMap((folder, index): CatalogSourceConfig[] => {
    const sourceId = catalogGenreSourceId(folder.genre);
    return known.has(sourceId) ? [] : [{ sourceId, locale: "pt-BR", folderId: folder.folderId, mode: "structured", enabled: true, priority: 100 + index, genre: folder.genre }];
  });
  return [...sources, ...genres];
}
