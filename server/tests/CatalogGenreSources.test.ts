import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CatalogApplicationService } from "../src/catalog/CatalogApplicationService.js";
import { catalogGenreFolders, catalogGenreId, withCatalogGenreSources } from "../src/catalog/CatalogGenreSources.js";
import { catalogSourcesFromEnvironment } from "../src/catalog/CatalogSourceRegistry.js";
import { HybridCatalogSourceProvider } from "../src/catalog/HybridCatalogSourceProvider.js";
import { PublicDriveFolderReader } from "../src/catalog/PublicDriveFolderReader.js";
import { StructuredDriveCatalogProvider, type CatalogJsonReader } from "../src/catalog/StructuredDriveCatalogProvider.js";
import type { CatalogStore } from "../src/catalog/CatalogRepository.js";
import type { CatalogSourceConfig } from "../src/catalog/types.js";

/** Same shape as the published genre catalogues: a bare array of entries. */
const entry = (index: number, format: string, extra: Record<string, unknown> = {}) => ({
  title: `Livro ${index}`, author: `Autor ${index}`, language: "pt", description: "metadado bruto do arquivo",
  bookId: `bk_${String(index).padStart(64, "0")}`, genre: "Outro nome", summary: null, synopsis: null, format,
  sha256: String(index).padStart(64, "a"), fileSize: 1000 + index, locale: "pt-BR",
  driveFileId: `drive-file-${index}-abcdef`, downloadUrl: `https://drive.google.com/uc?export=download&id=drive-file-${index}-abcdef`,
  coverDriveFileId: `cover-file-${index}-abcdef`, coverUrl: `https://lh3.googleusercontent.com/d/cover-file-${index}-abcdef`,
  uploadedAt: "2026-09-16T02:43:14.475133+00:00", ...extra,
});
const reader = (documents: Record<string, unknown>): CatalogJsonReader & { calls: string[] } => {
  const calls: string[] = [];
  return { calls, read: async (folderId) => { calls.push(folderId); const value = documents[folderId]; if (value instanceof Error) throw value; return value ?? null; } };
};
const genreSources = withCatalogGenreSources([]);
const [artes, administracao] = genreSources as [CatalogSourceConfig, CatalogSourceConfig];

describe("gêneros do catálogo no Google Drive", () => {
  it("registra Artes e música e Administração e economia como fontes estruturadas próprias", () => {
    assert.deepEqual(catalogGenreFolders.map((folder) => folder.genre), ["Artes e música", "Administração e economia"]);
    assert.equal(artes.folderId, "1Yc2qLF5v5j163qtkqK0pnwKxL-uERNF0");
    assert.equal(administracao.folderId, "10bXreEgmEAQGwjKW7-InnlX92YZ9VcNj");
    assert.deepEqual(genreSources.map((source) => [source.sourceId, source.mode, source.genre]), [
      ["genre-artes-e-musica", "structured", "Artes e música"],
      ["genre-administracao-e-economia", "structured", "Administração e economia"],
    ]);
    assert.equal(catalogGenreId("Administração e economia"), "administracao-e-economia");
  });

  it("mantém a fonte existente e acrescenta os gêneros depois dela", () => {
    const sources = withCatalogGenreSources(catalogSourcesFromEnvironment(undefined, "legacy-folder-123"));
    assert.deepEqual(sources.map((source) => source.sourceId), ["legacy-br-01", "genre-artes-e-musica", "genre-administracao-e-economia"]);
    const overridden = withCatalogGenreSources(catalogSourcesFromEnvironment(JSON.stringify([{ sourceId: "genre-artes-e-musica", locale: "pt-BR", folderId: "other-folder-123", mode: "structured", genre: "Artes e música" }]), "legacy-folder-123"));
    assert.deepEqual(overridden.map((source) => [source.sourceId, source.folderId]), [["genre-artes-e-musica", "other-folder-123"], ["genre-administracao-e-economia", "10bXreEgmEAQGwjKW7-InnlX92YZ9VcNj"]]);
  });

  it("monta cada livro com coverUrl, synopsis, format e downloadUrl do catalog.json", async () => {
    const provider = new StructuredDriveCatalogProvider(artes, undefined, undefined, reader({ [artes.folderId]: [
      entry(1, "epub", { synopsis: "Sinopse oficial.", summary: "Sinopse oficial." }),
      entry(2, "pdf", { summary: "Resumo antigo." }),
      entry(3, "epub"),
      entry(4, "mobi"),
      entry(1, "epub"),
    ] }));
    const { items } = await provider.list({ offset: 0, limit: 50 });
    assert.equal(items.length, 3, "mobi não tem leitor e bookId repetido não duplica");
    const [first, second, third] = items;
    assert.equal(first!.coverUrl, "https://lh3.googleusercontent.com/d/cover-file-1-abcdef");
    assert.equal(first!.downloadUrl, "https://drive.google.com/uc?export=download&id=drive-file-1-abcdef");
    assert.equal(first!.description, "Sinopse oficial.");
    assert.equal(second!.description, "Resumo antigo.");
    assert.equal(third!.description, null, "sem synopsis não inventa texto nem usa o metadado bruto");
    assert.deepEqual(items.map((book) => [book.format, book.genreId, book.genreName]), [["epub", "artes-e-musica", "Artes e música"], ["pdf", "artes-e-musica", "Artes e música"], ["epub", "artes-e-musica", "Artes e música"]]);
  });

  it("recusa downloadUrl fora do Google Drive e coverUrl sem https", async () => {
    const provider = new StructuredDriveCatalogProvider(artes, undefined, undefined, reader({ [artes.folderId]: [entry(1, "pdf", { downloadUrl: "https://example.com/livro.pdf", coverUrl: "http://lh3.googleusercontent.com/d/x" })] }));
    const [book] = (await provider.list({ offset: 0, limit: 1 })).items;
    assert.equal(book!.downloadUrl, null);
    assert.match(book!.coverUrl!, /^https:\/\/drive\.google\.com\/thumbnail\?id=cover-file-1-abcdef/);
  });

  it("cada gênero filtra só o próprio catálogo e uma fonte com falha não derruba a outra", async () => {
    const documents = reader({ [artes.folderId]: new Error("DRIVE_DOWN"), [administracao.folderId]: [entry(7, "epub"), entry(8, "pdf")] });
    const providers = genreSources.map((source) => new StructuredDriveCatalogProvider(source, undefined, undefined, documents));
    const hybrid = new HybridCatalogSourceProvider(async () => providers);
    const all = await hybrid.list({ offset: 0, limit: 50, locale: "pt-BR" });
    assert.equal(all.items.length, 2);
    assert.deepEqual(all.genres, [{ id: "administracao-e-economia", name: "Administração e economia" }]);
    assert.equal((await hybrid.list({ offset: 0, limit: 50, locale: "pt-BR", genreId: "artes-e-musica" })).items.length, 0);
    assert.equal((await hybrid.list({ offset: 0, limit: 50, locale: "pt-BR", genreId: "administracao-e-economia" })).items.length, 2);
  });

  it("o download entrega primeiro o downloadUrl do catálogo", async () => {
    const provider = new StructuredDriveCatalogProvider(administracao, undefined, undefined, reader({ [administracao.folderId]: [entry(9, "epub")] }));
    const service = new CatalogApplicationService({} as CatalogStore, () => { throw new Error("not used"); }, new HybridCatalogSourceProvider(async () => [provider]));
    const link = await service.download(entry(9, "epub").bookId, "pt-BR");
    assert.equal(link.downloadUrl, "https://drive.google.com/uc?export=download&id=drive-file-9-abcdef");
    assert.equal(link.downloadUrls[0], link.downloadUrl);
    assert.equal(new Set(link.downloadUrls).size, link.downloadUrls.length);
    assert.equal(link.coverUrl, "https://lh3.googleusercontent.com/d/cover-file-9-abcdef");
    assert.equal(link.format, "epub");
  });

  it("encontra catalog.json na listagem pública da pasta", async () => {
    const folder = new PublicDriveFolderReader(async () => new Response('<tr data-id="catalog-file-123" aria-label="catalog.json Unknown Shared"></tr>'));
    assert.deepEqual(await folder.files("folder-id-123"), [{ fileId: "catalog-file-123", name: "catalog.json" }]);
  });
});
