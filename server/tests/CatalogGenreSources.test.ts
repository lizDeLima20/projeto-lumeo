import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { CatalogApplicationService } from "../src/catalog/CatalogApplicationService.js";
import { ConfiguredCatalogSources, catalogGenreId, genreSourceConfig } from "../src/catalog/CatalogGenreSources.js";
import { CatalogSourceAdminService } from "../src/catalog/CatalogSourceAdminService.js";
import { CatalogSourceRegistry, catalogSourcesFromEnvironment } from "../src/catalog/CatalogSourceRegistry.js";
import type { CatalogGenreSource, CatalogGenreSourceInput, CatalogSourceStore } from "../src/catalog/CatalogSourceRepository.js";
import { GoogleDriveFolderLink } from "../src/catalog/GoogleDriveFolderLink.js";
import { HybridCatalogSourceProvider } from "../src/catalog/HybridCatalogSourceProvider.js";
import { PublicDriveFolderReader } from "../src/catalog/PublicDriveFolderReader.js";
import { StructuredDriveCatalogProvider, type CatalogJsonReader } from "../src/catalog/StructuredDriveCatalogProvider.js";
import type { CatalogStore } from "../src/catalog/CatalogRepository.js";
import { ApiError } from "../src/errors/ApiError.js";

/** Same shape as the published genre catalogues: a bare array of entries. */
const entry = (index: number, format: string, extra: Record<string, unknown> = {}) => ({
  title: `Livro ${index}`, author: `Autor ${index}`, language: "pt", description: "metadado bruto do arquivo",
  bookId: `bk_${String(index).padStart(64, "0")}`, genre: "Outro nome", summary: null, synopsis: null, format,
  sha256: String(index).padStart(64, "a"), fileSize: 1000 + index, locale: "pt-BR",
  driveFileId: `drive-file-${index}-abcdef`, downloadUrl: `https://drive.google.com/uc?export=download&id=drive-file-${index}-abcdef`,
  coverDriveFileId: `cover-file-${index}-abcdef`, coverUrl: `https://lh3.googleusercontent.com/d/cover-file-${index}-abcdef`,
  uploadedAt: "2026-09-16T02:43:14.475133+00:00", ...extra,
});

class MemorySourceStore implements CatalogSourceStore {
  public rows: CatalogGenreSource[] = [];
  private next = 1;
  public async list() { return [...this.rows]; }
  public async get(id: string) { return this.rows.find((row) => row.id === id) ?? null; }
  public async create(input: CatalogGenreSourceInput) {
    if (this.rows.some((row) => row.folderId === input.folderId || row.genre.toLowerCase() === input.genre.toLowerCase())) throw new ApiError(409, "CATALOG_SOURCE_DUPLICATE", "duplicado");
    const now = new Date().toISOString(), row = { id: `00000000-0000-4000-8000-${String(this.next++).padStart(12, "0")}`, locale: "pt-BR", createdAt: now, updatedAt: now, ...input };
    this.rows.push(row); return row;
  }
  public async update(id: string, input: Partial<CatalogGenreSourceInput>) {
    const row = this.rows.find((value) => value.id === id); if (!row) throw new ApiError(404, "CATALOG_SOURCE_NOT_FOUND", "x");
    Object.assign(row, input); return row;
  }
  public async remove(id: string) { this.rows = this.rows.filter((row) => row.id !== id); }
}

/** A Drive stand-in keyed by folder ID: a document, null (no catalog.json) or an error (no access). */
const drive = (folders: Record<string, unknown>): CatalogJsonReader => ({
  read: async (folderId) => { const value = folders[folderId]; if (value instanceof Error) throw value; if (value === undefined) throw new Error("CATALOG_PUBLIC_SOURCE_UNAVAILABLE"); return value; },
});
const ARTES = "1Yc2qLF5v5j163qtkqK0pnwKxL-uERNF0", ADMINISTRACAO = "10bXreEgmEAQGwjKW7-lnnIX92YZ9VcNj";

function setup(folders: Record<string, unknown>, admin = true) {
  const store = new MemorySourceStore(), reader = drive(folders);
  const configured = new ConfiguredCatalogSources(catalogSourcesFromEnvironment(undefined, "legacy-folder-123"), store, 60_000);
  const registry = new CatalogSourceRegistry(() => configured.all(), {
    legacy: (source) => ({ source, provider: "legacy", list: async () => ({ items: [], nextCursor: null }), get: async () => null, diagnostic: () => ({ sourceId: source.sourceId, locale: source.locale, mode: "legacy", provider: "legacy" }) }),
    structured: (source) => new StructuredDriveCatalogProvider(source, undefined, undefined, reader),
  });
  const admin$ = new CatalogSourceAdminService(store, configured, registry, async () => admin);
  const catalog = new HybridCatalogSourceProvider((locale) => registry.providers(locale));
  return { store, registry, admin: admin$, catalog };
}

describe("link da pasta do Google Drive", () => {
  it("extrai o folderId das variações do link", () => {
    for (const link of [
      `https://drive.google.com/drive/folders/${ARTES}`,
      `https://drive.google.com/drive/folders/${ARTES}?usp=sharing`,
      `https://drive.google.com/drive/u/0/folders/${ARTES}/`,
      `drive.google.com/drive/folders/${ARTES}`,
      `https://drive.google.com/open?id=${ARTES}`,
      `https://drive.google.com/folderview?id=${ARTES}&usp=sharing`,
      `  ${ARTES}  `,
    ]) assert.equal(GoogleDriveFolderLink.folderId(link), ARTES, link);
  });
  it("recusa links que não são pastas do Drive", () => {
    for (const link of ["https://example.com/drive/folders/1Yc2qLF5v5j163qtkqK0pnwKxL", "https://drive.google.com/file/d/1Yc2qLF5v5j163qtkqK0pnwKxL/view", "pasta", "javascript:alert(1)"]) {
      assert.throws(() => GoogleDriveFolderLink.folderId(link), (error: unknown) => error instanceof ApiError && error.code === "CATALOG_SOURCE_LINK_INVALID", link);
    }
  });
});

describe("fontes do catálogo cadastradas", () => {
  it("não existe mais lista de gêneros no código: a migração traz os dois gêneros atuais", () => {
    const code = readdirSync("server/src/catalog").map((file) => readFileSync(`server/src/catalog/${file}`, "utf8")).join("\n");
    assert.equal(code.includes(ARTES), false); assert.equal(code.includes("Artes e música"), false);
    const migration = readFileSync("supabase/migrations/202609170001_catalog_sources.sql", "utf8");
    assert.match(migration, /create table if not exists public\.catalog_sources/);
    assert.match(migration, new RegExp(`'Artes e música', 'https://drive\\.google\\.com/drive/folders/${ARTES}', '${ARTES}'`));
    assert.match(migration, new RegExp(`'Administração e economia', 'https://drive\\.google\\.com/drive/folders/${ADMINISTRACAO}', '${ADMINISTRACAO}'`));
    assert.match(migration, /enable row level security/);
  });

  it("cadastrar só nome e link cria o gênero e o chip, sem deploy", async () => {
    const { admin, catalog } = setup({ [ARTES]: [entry(1, "epub", { synopsis: "Sinopse." }), entry(2, "pdf"), entry(3, "mobi"), entry(1, "epub")] });
    assert.deepEqual((await catalog.list({ offset: 0, limit: 50, locale: "pt-BR" })).genres, []);
    const saved = await admin.create("admin-user", { genre: "  Artes   e música ", driveFolderUrl: `https://drive.google.com/drive/folders/${ARTES}?usp=sharing` });
    assert.equal(saved.genre, "Artes e música");
    assert.equal(saved.folderId, ARTES);
    assert.equal(saved.driveFolderUrl, `https://drive.google.com/drive/folders/${ARTES}`);
    assert.deepEqual(saved.report.inspection, { entries: 4, validBooks: 2, withSynopsis: 1, validCovers: 2, mobiIgnored: 1, unsupportedIgnored: 0, invalidEntries: 0, duplicates: 1 });
    assert.equal(saved.report.status, "OK");
    const page = await catalog.list({ offset: 0, limit: 50, locale: "pt-BR" });
    assert.deepEqual(page.genres, [{ id: "artes-e-musica", name: "Artes e música" }]);
    assert.deepEqual(page.items.map((book) => [book.genreId, book.format, book.description]), [["artes-e-musica", "epub", "Sinopse."], ["artes-e-musica", "pdf", null]]);
  });

  it("uma pasta sem acesso aparece como tal e não derruba os outros gêneros", async () => {
    const { admin, catalog } = setup({ [ARTES]: [entry(1, "epub")], [ADMINISTRACAO]: new ApiError(503, "CATALOG_DRIVE_FORBIDDEN", "sem acesso") });
    await admin.create("admin-user", { genre: "Artes e música", driveFolderUrl: ARTES });
    const failing = await admin.create("admin-user", { genre: "Administração e economia", driveFolderUrl: `https://drive.google.com/drive/folders/${ADMINISTRACAO}` });
    assert.deepEqual([failing.report.status, failing.report.folderFound, failing.report.catalogFound], ["NO_ACCESS", false, false]);
    const listed = await admin.list("admin-user");
    assert.deepEqual(listed.map((source) => [source.genre, source.report.status, source.report.inspection?.validBooks ?? 0]), [["Artes e música", "OK", 1], ["Administração e economia", "NO_ACCESS", 0]]);
    const page = await catalog.list({ offset: 0, limit: 50, locale: "pt-BR" });
    assert.equal(page.items.length, 1);
    assert.deepEqual(page.genres, [{ id: "artes-e-musica", name: "Artes e música" }]);
  });

  it("testar pasta distingue pasta sem catalog.json e catalog.json inválido, sem salvar", async () => {
    const { admin, store } = setup({ "folder-without-catalog": null, "folder-with-broken-json": new ApiError(422, "CATALOG_SOURCE_INVALID", "x"), "folder-with-object": { books: "nope" } });
    assert.equal((await admin.test("admin-user", { driveFolderUrl: "https://drive.google.com/drive/folders/folder-without-catalog" })).status, "NO_CATALOG");
    assert.equal((await admin.test("admin-user", { driveFolderUrl: "folder-with-broken-json" })).status, "INVALID_CATALOG");
    assert.equal((await admin.test("admin-user", { driveFolderUrl: "folder-with-object" })).status, "INVALID_CATALOG");
    assert.equal((await admin.test("admin-user", { driveFolderUrl: "unknown-folder-123" })).status, "NO_ACCESS");
    assert.equal(store.rows.length, 0);
  });

  it("editar, desativar e remover refletem na biblioteca imediatamente", async () => {
    const { admin, catalog } = setup({ [ARTES]: [entry(1, "epub")], [ADMINISTRACAO]: [entry(2, "pdf"), entry(3, "pdf")] });
    const source = await admin.create("admin-user", { genre: "Artes", driveFolderUrl: ARTES });
    const renamed = await admin.update("admin-user", source.id, { genre: "Artes e música", driveFolderUrl: ADMINISTRACAO });
    assert.deepEqual([renamed.genre, renamed.folderId, renamed.report.inspection?.validBooks], ["Artes e música", ADMINISTRACAO, 2]);
    assert.deepEqual((await catalog.list({ offset: 0, limit: 50, locale: "pt-BR", genreId: "artes-e-musica" })).items.map((book) => book.bookId), [entry(2, "pdf").bookId, entry(3, "pdf").bookId]);
    const disabled = await admin.update("admin-user", source.id, { enabled: false });
    assert.equal(disabled.report.status, "DISABLED");
    assert.equal((await catalog.list({ offset: 0, limit: 50, locale: "pt-BR" })).items.length, 0);
    await admin.remove("admin-user", source.id);
    assert.deepEqual(await admin.list("admin-user"), []);
  });

  it("valida nome, link e duplicidade, e exige administrador", async () => {
    const { admin } = setup({ [ARTES]: [] });
    await assert.rejects(admin.create("admin-user", { genre: "", driveFolderUrl: ARTES }), { code: "CATALOG_SOURCE_GENRE_INVALID" });
    await assert.rejects(admin.create("admin-user", { genre: "Romance", driveFolderUrl: "https://example.com/x" }), { code: "CATALOG_SOURCE_LINK_INVALID" });
    const empty = await admin.create("admin-user", { genre: "Romance", driveFolderUrl: ARTES });
    assert.equal(empty.report.status, "EMPTY");
    await assert.rejects(admin.create("admin-user", { genre: "romance", driveFolderUrl: ADMINISTRACAO }), { code: "CATALOG_SOURCE_DUPLICATE" });
    const reader = setup({}, false).admin;
    await assert.rejects(reader.list("reader-user"), { code: "CATALOG_ADMIN_REQUIRED" });
    await assert.rejects(reader.create("reader-user", { genre: "Terror", driveFolderUrl: ARTES }), { code: "CATALOG_ADMIN_REQUIRED" });
    await assert.rejects(reader.test("reader-user", { driveFolderUrl: ARTES }), { code: "CATALOG_ADMIN_REQUIRED" });
  });

  it("a falha do armazenamento de fontes mantém a fonte existente", async () => {
    const broken: CatalogSourceStore = { ...new MemorySourceStore(), list: async () => { throw new ApiError(503, "CATALOG_SOURCES_NOT_MIGRATED", "x"); } } as CatalogSourceStore;
    const sources = await new ConfiguredCatalogSources(catalogSourcesFromEnvironment(undefined, "legacy-folder-123"), broken).all();
    assert.deepEqual(sources.map((source) => source.sourceId), ["legacy-br-01"]);
  });

  it("gênero cadastrado vira fonte estruturada com id estável", () => {
    const config = genreSourceConfig({ id: "00000000-0000-4000-8000-000000000001", genre: "Administração e economia", driveFolderUrl: "", folderId: ADMINISTRACAO, locale: "pt-BR", enabled: true, createdAt: "", updatedAt: "" });
    assert.deepEqual([config.sourceId, config.mode, config.genre, config.folderId], ["genre-00000000-0000-4000-8000-000000000001", "structured", "Administração e economia", ADMINISTRACAO]);
    assert.equal(catalogGenreId("Administração e economia"), "administracao-e-economia");
  });
});

describe("livros de uma pasta de gênero", () => {
  const source = genreSourceConfig({ id: "00000000-0000-4000-8000-000000000009", genre: "Artes e música", driveFolderUrl: "", folderId: ARTES, locale: "pt-BR", enabled: true, createdAt: "", updatedAt: "" });

  it("usa coverUrl, synopsis (summary como reserva), format e downloadUrl do catalog.json", async () => {
    const provider = new StructuredDriveCatalogProvider(source, undefined, undefined, drive({ [ARTES]: [
      entry(1, "epub", { synopsis: "Sinopse oficial.", summary: "Sinopse oficial." }),
      entry(2, "pdf", { summary: "Resumo antigo." }),
      entry(3, "epub"),
    ] }));
    const [first, second, third] = (await provider.list({ offset: 0, limit: 50 })).items;
    assert.equal(first!.coverUrl, "https://lh3.googleusercontent.com/d/cover-file-1-abcdef");
    assert.equal(first!.downloadUrl, "https://drive.google.com/uc?export=download&id=drive-file-1-abcdef");
    assert.equal(first!.description, "Sinopse oficial.");
    assert.equal(second!.description, "Resumo antigo.");
    assert.equal(third!.description, null, "sem synopsis não inventa texto nem usa o metadado bruto");
  });

  it("recusa downloadUrl fora do Google Drive e coverUrl sem https", async () => {
    const provider = new StructuredDriveCatalogProvider(source, undefined, undefined, drive({ [ARTES]: [entry(1, "pdf", { downloadUrl: "https://example.com/livro.pdf", coverUrl: "http://lh3.googleusercontent.com/d/x" })] }));
    const [book] = (await provider.list({ offset: 0, limit: 1 })).items;
    assert.equal(book!.downloadUrl, null);
    assert.match(book!.coverUrl!, /^https:\/\/drive\.google\.com\/thumbnail\?id=cover-file-1-abcdef/);
  });

  it("o mesmo livro pode pertencer a dois gêneros, sem sumir do segundo", async () => {
    const shared = entry(11, "epub", { synopsis: "Em dois gêneros." });
    const aventura = genreSourceConfig({ id: "00000000-0000-4000-8000-00000000000a", genre: "Aventura", driveFolderUrl: "", folderId: ARTES, locale: "pt-BR", enabled: true, createdAt: "", updatedAt: "" });
    const pessoal = genreSourceConfig({ id: "00000000-0000-4000-8000-00000000000b", genre: "Desenvolvimento pessoal", driveFolderUrl: "", folderId: ADMINISTRACAO, locale: "pt-BR", enabled: true, createdAt: "", updatedAt: "" });
    const documents = drive({ [ARTES]: [shared, entry(12, "epub")], [ADMINISTRACAO]: [shared, entry(13, "pdf")] });
    const providers = [aventura, pessoal].map((source) => new StructuredDriveCatalogProvider(source, undefined, undefined, documents));
    const hybrid = new HybridCatalogSourceProvider(async () => providers);
    assert.deepEqual((await hybrid.list({ offset: 0, limit: 50, locale: "pt-BR", genreId: "aventura" })).items.map((book) => book.bookId), [shared.bookId, entry(12, "epub").bookId]);
    assert.deepEqual((await hybrid.list({ offset: 0, limit: 50, locale: "pt-BR", genreId: "desenvolvimento-pessoal" })).items.map((book) => book.bookId), [shared.bookId, entry(13, "pdf").bookId]);
    // Without a genre filter the shared book is listed once, not twice.
    const all = await hybrid.list({ offset: 0, limit: 50, locale: "pt-BR" });
    assert.deepEqual(all.items.map((book) => book.bookId), [shared.bookId, entry(12, "epub").bookId, entry(13, "pdf").bookId]);
    assert.deepEqual(all.genres, [{ id: "aventura", name: "Aventura" }, { id: "desenvolvimento-pessoal", name: "Desenvolvimento pessoal" }]);
  });

  it("o download devolve só links do Drive para o navegador, com o do catálogo primeiro", async () => {
    const provider = new StructuredDriveCatalogProvider(source, undefined, undefined, drive({ [ARTES]: [entry(9, "epub")] }));
    const service = new CatalogApplicationService({} as CatalogStore, () => { throw new Error("not used"); }, new HybridCatalogSourceProvider(async () => [provider]));
    const link = await service.download(entry(9, "epub").bookId, "pt-BR");
    assert.equal(link.downloadUrl, "https://drive.google.com/uc?export=download&id=drive-file-9-abcdef");
    assert.equal(link.downloadUrls[0], link.downloadUrl);
    assert.ok(link.downloadUrls.every((url) => /^https:\/\/drive(\.usercontent)?\.google\.com\//.test(url)));
    assert.equal(link.coverUrl, "https://lh3.googleusercontent.com/d/cover-file-9-abcdef");
  });

  it("encontra catalog.json na listagem pública da pasta", async () => {
    const folder = new PublicDriveFolderReader(async () => new Response('<tr data-id="catalog-file-123" aria-label="catalog.json Unknown Shared"></tr>'));
    assert.deepEqual(await folder.files("folder-id-123"), [{ fileId: "catalog-file-123", name: "catalog.json" }]);
  });

  it("o registro reconstrói o provider quando a pasta do gênero muda", async () => {
    let calls = 0;
    const registry = new CatalogSourceRegistry([], { legacy: () => { throw new Error("unused"); }, structured: (value) => { calls++; return new StructuredDriveCatalogProvider(value, undefined, undefined, drive({})); } });
    const first = await registry.provider(source), again = await registry.provider(source), moved = await registry.provider({ ...source, folderId: ADMINISTRACAO });
    assert.equal(first, again); assert.notEqual(first, moved); assert.equal(calls, 2);
  });
});
