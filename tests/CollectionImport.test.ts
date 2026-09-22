import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { BookFileRepository } from "../src/repositories/BookFileRepository";
import { BookRepository } from "../src/repositories/BookRepository";
import { LibraryChecksumRepository } from "../src/repositories/LibraryChecksumRepository";
import { IndexedDbService } from "../src/services/IndexedDbService";
import { ImportManager } from "../src/services/ImportManager";
import { LocalFileImporter } from "../src/importers/LocalFileImporter";
import { CollectionImportService, CollectionFormatUnsupportedError, CollectionFileMismatchError } from "../src/services/CollectionImportService";
import { ComicContentTypeResolver } from "../src/reader/comic/ComicContentType";
import { ComicCollectionTrail, ComicShelfGrouping } from "../src/reader/comic/ComicCollectionTrail";
import { ComicGenreShelf } from "../src/components/ComicGenreShelf";
import { Book } from "../src/models/Book";
import type { CatalogDownloadReceipt, CatalogDownloadService } from "../src/services/CatalogDownloadService";
import type { CoverService } from "../src/services/CoverService";
import type { DriveFolderEntry, DriveFolderListing } from "../src/services/DriveCollectionService";

Object.assign(globalThis, { indexedDB, IDBKeyRange });
const source = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const ROOT = "1wXs64lZ0nOBAAWwGutDHfjO-TnfYO6Ee";
// A minimal real PDF; the tag makes every file's bytes (and hash) different.
const pdfBytes = (tag = "") => new TextEncoder().encode(`%PDF-1.4\n%${tag}\n`);
const comic = (id: string, over: Partial<DriveFolderEntry> = {}): DriveFolderEntry => ({
  id, name: "Capítulo 01", kind: "file", mimeType: "application/pdf", format: "pdf", supported: true,
  contentType: "comic", size: null, modifiedAt: null, ...over,
});
const listing = (...folders: [string, string][]): Pick<DriveFolderListing, "folderId" | "breadcrumb"> => ({
  folderId: folders.at(-1)?.[0] ?? ROOT,
  breadcrumb: [{ id: ROOT, name: "HQs da Marvel" }, ...folders.map(([id, name]) => ({ id, name }))],
});
const covers = { fromBookFile: async () => "data:image/png;base64,primeira-pagina" } as unknown as CoverService;

function environment(receipt: (file: File) => CatalogDownloadReceipt = file => ({ kind: "native-file", file })) {
  const database = new IndexedDbService(`lumeo-collection-${crypto.randomUUID()}`);
  const books = new BookRepository(database);
  const imports = new ImportManager(new LocalFileImporter(), books, new BookFileRepository(database), undefined, undefined, undefined, undefined, new LibraryChecksumRepository(database));
  const library: Book[] = [];
  let count = 0;
  const downloaded: string[] = [];
  const downloads: CatalogDownloadService = {
    target: "android-private-storage",
    download: async link => { downloaded.push(link.downloadUrl); return receipt(new File([pdfBytes(`hq-${++count}`)], link.expectedFilename, { type: "application/pdf" })); },
  };
  const service = new CollectionImportService(downloads, imports, covers, id => library.find(book => book.catalogBookId === id));
  const add = async (entry: DriveFolderEntry, where: Pick<DriveFolderListing, "folderId" | "breadcrumb">) => {
    const result = await service.add({ collectionId: "marvel-hqs", entry, listing: where, genreId: "hqs" });
    if (result.kind === "saved") library.push(result.book);
    return result;
  };
  return { service, books, downloaded, database, library, add };
}

describe("o bug: só a primeira HQ entrava na biblioteca", () => {
  it("duas 'Capítulo 01' de séries diferentes entram as duas", async () => {
    // Before: the second one threw BookVersionConflictError ("outra versão deste livro").
    const { add, books } = environment();
    assert.equal((await add(comic("fenix-01"), listing(["fenix", "Fênix"]))).kind, "saved");
    assert.equal((await add(comic("deadpool-01"), listing(["deadpool", "Deadpool"]))).kind, "saved");
    assert.equal((await books.getAll()).length, 2);
  });
  it("o título leva o arco: 'Capítulo 01' sozinho não diz nada numa prateleira", () => {
    const { service } = environment();
    assert.equal(service.title(comic("x"), listing(["gs", "Guerras Secretas"], ["cat", "Cataclismo"])), "Cataclismo — Capítulo 01");
    assert.equal(service.title(comic("x", { name: "Fênix 01.pdf" }), listing(["fenix", "Fênix"])), "Fênix 01");
  });
});

describe("adicionar a HQ à biblioteca", () => {
  it("cria um Book comic com a origem e a trilha da coleção", async () => {
    const { add, books } = environment();
    const result = await add(comic("1AlRcuMN"), listing(["gs", "Guerras Secretas"], ["y", "2015"], ["cat", "Cataclismo"]));
    assert.equal(result.kind, "saved");
    const book = result.kind === "saved" ? result.book : null;
    assert.ok(book);
    assert.equal(book.contentType, "comic");
    assert.equal(book.fileType, "pdf");
    assert.equal(book.catalogBookId, "marvel-hqs:1AlRcuMN");
    assert.equal(book.collectionId, "marvel-hqs");
    assert.equal(book.series, "Guerras Secretas");
    assert.equal(book.cover, "data:image/png;base64,primeira-pagina");
    const trail = ComicCollectionTrail.parse(book.collectionPath)!;
    assert.deepEqual(trail.ids, [ROOT, "gs", "y", "cat"]);
    assert.equal(trail.collection, "Guerras Secretas");
    assert.deepEqual(trail.arcs, ["2015", "Cataclismo"]);
    assert.equal((await books.get(book.id))?.contentType, "comic");
  });
  it("a mesma HQ duas vezes não duplica: devolve a que já está lá", async () => {
    const { add, books, downloaded } = environment();
    const first = await add(comic("fenix-01"), listing(["fenix", "Fênix"]));
    const again = await add(comic("fenix-01"), listing(["fenix", "Fênix"]));
    assert.equal(again.kind, "existing");
    assert.equal(again.kind === "existing" && first.kind === "saved" && again.book.id === first.book.id, true);
    assert.equal((await books.getAll()).length, 1);
    assert.equal(downloaded.length, 1, "nem baixa de novo");
  });
  it("continua lá e abre no ComicReader depois de fechar e reabrir o app", async () => {
    const { add, database } = environment();
    const result = await add(comic("fenix-01"), listing(["fenix", "Fênix"]));
    const saved = result.kind === "saved" ? result.book : null;
    assert.ok(saved);
    const name = (database as unknown as { databaseName: string }).databaseName;
    const reopened = await new BookRepository(new IndexedDbService(name)).get(saved.id);
    const file = await new BookFileRepository(new IndexedDbService(name)).get(saved.id);
    assert.ok(reopened && file, "o livro e o arquivo local sobrevivem");
    assert.equal(reopened.availability, "AVAILABLE");
    assert.equal(new ComicContentTypeResolver().isComic(reopened), true);
  });
  it("CBR não entra e nem é baixado", async () => {
    const { add, downloaded } = environment();
    await assert.rejects(() => add(comic("cbr", { format: "cbr", supported: false, contentType: undefined }), listing(["x", "X"])),
      (error: unknown) => error instanceof CollectionFormatUnsupportedError && error.format === "cbr");
    assert.deepEqual(downloaded, []);
  });
});

describe("fluxo do navegador: baixar, depois escolher o arquivo", () => {
  it("o download não salva nada: o passo dois recebe o arquivo escolhido", async () => {
    const { service, books } = environment(() => ({ kind: "browser-download" }));
    const request = { collectionId: "marvel-hqs", entry: comic("fenix-01", { size: 18 }), listing: listing(["fenix", "Fênix"]), genreId: "hqs" };
    assert.deepEqual(await service.download(request), { kind: "browser-download", expectedFilename: "Capítulo 01.pdf" });
    assert.equal((await books.getAll()).length, 0);
    // The browser may rename it "Capítulo 01 (1).pdf"; the size Drive reported is what counts.
    const picked = new File([pdfBytes("abcdefg")], "Capítulo 01 (1).pdf", { type: "application/pdf" });
    assert.equal(picked.size, 18);
    const result = await service.addDownloadedFile(request, picked);
    assert.equal(result.kind, "saved");
    assert.equal(result.kind === "saved" && result.book.catalogBookId, "marvel-hqs:fenix-01");
    assert.equal(result.kind === "saved" && result.book.fileName, "Capítulo 01.pdf");
  });
  it("um PDF que não é esta HQ é recusado antes de salvar", async () => {
    const { service, books } = environment(() => ({ kind: "browser-download" }));
    const request = { collectionId: "marvel-hqs", entry: comic("fenix-01", { size: 20_603_110 }), listing: listing(["fenix", "Fênix"]), genreId: "hqs" };
    await assert.rejects(() => service.addDownloadedFile(request, new File([pdfBytes("outro")], "Capítulo 01.pdf")), CollectionFileMismatchError);
    assert.equal((await books.getAll()).length, 0);
  });
  it("o Chrome usa o mesmo seletor de arquivo baixado dos livros do catálogo", () => {
    assert.match(source("core/App.ts"), /pickDownloaded: \(\) => new FileSystemFolderManager\(this\.database\)\.selectDownloadedBook\(\)/);
  });
});

describe("prateleira: agrupada por coleção, na ordem da árvore", () => {
  it("Fênix 01, Deadpool 01, Fênix 03, Homem-Aranha 01, Fênix 02 -> três fileiras, Fênix 01-02-03", async () => {
    const { add, library } = environment();
    for (const [id, folder, name] of [["f1", "Fênix", "Fênix 01"], ["d1", "Deadpool", "Deadpool 01"], ["f3", "Fênix", "Fênix 03"],
      ["h1", "Homem-Aranha", "Homem-Aranha 01"], ["f2", "Fênix", "Fênix 02"]] as const) {
      await add(comic(id, { name: `${name}.pdf` }), listing([folder.toLowerCase(), folder]));
    }
    assert.equal(library.length, 5, "as cinco entram");
    const rows = new ComicShelfGrouping().rows(library);
    assert.deepEqual(rows.map(row => row.title), ["Deadpool", "Fênix", "Homem-Aranha"]);
    assert.deepEqual(rows.find(row => row.title === "Fênix")!.books.map(book => book.title), ["Fênix 01", "Fênix 02", "Fênix 03"]);
  });
  it("ordena naturalmente: 1, 2, 10 - nunca 1, 10, 2", () => {
    const books = ["Capítulo 10", "Capítulo 2", "Capítulo 1"].map((name, index) => new Book({
      id: `b${index}`, title: name, author: "", genreId: "hqs", cover: "", fileType: "pdf", fileName: `${name}.pdf`, fileSize: 1,
      mimeType: "application/pdf", readingStatus: "unread", contentType: "comic",
      collectionPath: ComicCollectionTrail.fromBreadcrumb([{ id: ROOT, name: "HQs da Marvel" }, { id: "fenix", name: "Fênix" }]).serialize() }));
    const [row] = new ComicShelfGrouping().rows(books);
    assert.deepEqual(row!.books.map(book => book.title), ["Capítulo 1", "Capítulo 2", "Capítulo 10"]);
  });
  it("arcos ficam juntos dentro da coleção", () => {
    const trail = (...arcs: string[]) => ComicCollectionTrail.fromBreadcrumb([{ id: ROOT, name: "HQs da Marvel" }, { id: "gr", name: "A Guerra dos Reinos" },
      ...arcs.map(arc => ({ id: arc, name: arc }))]).serialize();
    const make = (id: string, file: string, ...arcs: string[]) => new Book({ id, title: file, author: "", genreId: "hqs", cover: "", fileType: "pdf",
      fileName: `${file}.pdf`, fileSize: 1, mimeType: "application/pdf", readingStatus: "unread", contentType: "comic", collectionPath: trail(...arcs) });
    const rows = new ComicShelfGrouping().rows([
      make("a", "Capítulo 02", "Caminho Para A Guerra Dos Reinos"), make("b", "Capítulo 01", "Tie-ins"),
      make("c", "Capítulo 01", "Caminho Para A Guerra Dos Reinos"), make("d", "Capítulo 10", "Caminho Para A Guerra Dos Reinos")]);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]!.books.map(book => book.id), ["c", "a", "d", "b"]);
  });
  it("só gênero feito inteiramente de HQs usa a prateleira por coleção", () => {
    const base = { author: "", genreId: "g", cover: "", fileType: "pdf" as const, fileName: "x.pdf", fileSize: 1, mimeType: "application/pdf", readingStatus: "unread" as const };
    const hq = new Book({ ...base, id: "hq", title: "HQ", contentType: "comic" });
    const livro = new Book({ ...base, id: "livro", title: "Livro" });
    assert.equal(ComicGenreShelf.handles([hq]), true);
    assert.equal(ComicGenreShelf.handles([hq, livro]), false, "gênero com livro comum segue na prateleira de sempre");
    assert.equal(ComicGenreShelf.handles([livro]), false);
  });
  it("a trilha antiga (só ids) continua legível", () => {
    const trail = ComicCollectionTrail.parse(`${ROOT}/gs/cat`)!;
    assert.deepEqual(trail.ids, [ROOT, "gs", "cat"]);
    assert.equal(trail.collection, null);
  });
});
