import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { BookFileRepository } from "../src/repositories/BookFileRepository";
import { BookRepository } from "../src/repositories/BookRepository";
import { IndexedDbService } from "../src/services/IndexedDbService";
import { ImportManager } from "../src/services/ImportManager";
import { LocalFileImporter } from "../src/importers/LocalFileImporter";
import { CollectionImportService, CollectionFormatUnsupportedError } from "../src/services/CollectionImportService";
import { ComicContentTypeResolver } from "../src/reader/comic/ComicContentType";
import type { CatalogDownloadReceipt, CatalogDownloadService } from "../src/services/CatalogDownloadService";
import type { CoverService } from "../src/services/CoverService";
import type { DriveFolderEntry, DriveFolderListing } from "../src/services/DriveCollectionService";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

const ROOT = "1wXs64lZ0nOBAAWwGutDHfjO-TnfYO6Ee";
/** Shaped after a file that really is in the collection: no extension in the name. */
const comic = (over: Partial<DriveFolderEntry> = {}): DriveFolderEntry => ({
  id: "1AlRcuMNiOtlpMeLJ3YFgShWOuN8L0TDC", name: "Capítulo 01", kind: "file",
  mimeType: "application/pdf", format: "pdf", supported: true, contentType: "comic",
  size: 12, modifiedAt: null, ...over,
});
const listing: Pick<DriveFolderListing, "folderId" | "breadcrumb"> = {
  folderId: "1uYOuqFWf-mz",
  breadcrumb: [{ id: ROOT, name: "HQs da Marvel" }, { id: "1gkcllmIzYL2", name: "Guerras Secretas" }, { id: "1uYOuqFWf-mz", name: "Cataclismo" }],
};
// A minimal real PDF: enough for LocalFileImporter to accept it as one.
const pdfBytes = () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3]);
const covers = { fromBookFile: async () => "data:image/png;base64,capa-da-primeira-pagina" } as unknown as CoverService;

function environment(receipt: (file: File) => CatalogDownloadReceipt = file => ({ kind: "native-file", file })) {
  const database = new IndexedDbService(`lumeo-collection-${crypto.randomUUID()}`);
  const books = new BookRepository(database);
  const imports = new ImportManager(new LocalFileImporter(), books, new BookFileRepository(database));
  const downloaded: string[] = [];
  const downloads: CatalogDownloadService = {
    target: "android-private-storage",
    download: async link => { downloaded.push(link.downloadUrl); return receipt(new File([pdfBytes()], link.expectedFilename, { type: "application/pdf" })); },
  };
  return { service: new CollectionImportService(downloads, imports, covers), books, downloaded, database };
}

describe("1/2. HQ da coleção entra na biblioteca", () => {
  it("cria o Book com contentType comic e a origem preservada", async () => {
    const { service, books } = environment();
    const result = await service.add({ collectionId: "marvel-hqs", entry: comic(), listing, genreId: "g1" });
    assert.equal(result.kind, "saved");
    const book = result.kind === "saved" ? result.book : null;
    assert.ok(book);
    assert.equal(book.contentType, "comic");
    assert.equal(book.title, "Capítulo 01");
    assert.equal(book.fileType, "pdf");
    assert.equal(book.mimeType, "application/pdf");
    // Origin: sourceId + driveFileId in catalogBookId, the folder trail in collectionPath.
    assert.equal(book.catalogBookId, "marvel-hqs:1AlRcuMNiOtlpMeLJ3YFgShWOuN8L0TDC");
    assert.equal(book.collectionPath, `${ROOT}/1gkcllmIzYL2/1uYOuqFWf-mz`);
    assert.equal(book.source, "google-drive");
    // Saved, not just returned.
    const stored = await books.get(book.id);
    assert.equal(stored?.contentType, "comic");
  });
  it("o arquivo sem extensão ganha .pdf, porque o mimeType já provou o que ele é", async () => {
    const { service, downloaded } = environment();
    assert.equal(service.filename(comic()), "Capítulo 01.pdf");
    assert.equal(service.filename(comic({ name: "Capítulo 02.pdf" })), "Capítulo 02.pdf");
    const result = await service.add({ collectionId: "marvel-hqs", entry: comic(), listing, genreId: "g1" });
    assert.equal(result.kind === "saved" && result.book.fileName, "Capítulo 01.pdf");
    assert.match(downloaded[0]!, /^https:\/\/drive\.google\.com\/uc\?export=download&id=1AlRcuMNiOtlpMeLJ3YFgShWOuN8L0TDC$/);
  });
  it("a capa é a primeira página do arquivo baixado", async () => {
    const { service } = environment();
    const result = await service.add({ collectionId: "marvel-hqs", entry: comic(), listing, genreId: "g1" });
    assert.equal(result.kind === "saved" && result.book.cover, "data:image/png;base64,capa-da-primeira-pagina");
  });
  it("no navegador o download cai no fluxo já existente de importar o arquivo baixado", async () => {
    const { service } = environment(() => ({ kind: "browser-download" }));
    const request = { collectionId: "marvel-hqs", entry: comic(), listing, genreId: "g1" };
    const result = await service.add(request);
    assert.deepEqual(result, { kind: "browser-download", expectedFilename: "Capítulo 01.pdf" });
    const book = await service.addDownloadedFile(request, new File([pdfBytes()], "Capítulo 01.pdf", { type: "application/pdf" }));
    assert.equal(book.contentType, "comic");
  });
});

describe("3. a HQ salva abre no ComicReader", () => {
  it("contentType comic faz a rota escolher o ComicReader", async () => {
    const { service } = environment();
    const result = await service.add({ collectionId: "marvel-hqs", entry: comic(), listing, genreId: "g1" });
    const book = result.kind === "saved" ? result.book : null;
    assert.ok(book);
    assert.equal(new ComicContentTypeResolver().isComic(book), true);
  });
  it("continua acessível depois de fechar e reabrir o app", async () => {
    const { service, database } = environment();
    const result = await service.add({ collectionId: "marvel-hqs", entry: comic(), listing, genreId: "g1" });
    const saved = result.kind === "saved" ? result.book : null;
    assert.ok(saved);
    // A new database handle over the same store is what a restart looks like here.
    const reopened = await new BookRepository(new IndexedDbService((database as unknown as { databaseName: string }).databaseName)).get(saved.id);
    assert.ok(reopened, "o livro tem de continuar na biblioteca");
    assert.equal(reopened.contentType, "comic");
    assert.equal(reopened.collectionPath, `${ROOT}/1gkcllmIzYL2/1uYOuqFWf-mz`);
    assert.equal(reopened.catalogBookId, "marvel-hqs:1AlRcuMNiOtlpMeLJ3YFgShWOuN8L0TDC");
    assert.equal(new ComicContentTypeResolver().isComic(reopened), true);
  });
});

describe("CBR não entra na biblioteca", () => {
  it("adicionar um CBR é recusado, com o formato no erro", async () => {
    const { service } = environment();
    const cbr = comic({ name: "Guerras Secretas 01.cbr", mimeType: "application/x-cbr", format: "cbr", supported: false, contentType: undefined });
    await assert.rejects(() => service.add({ collectionId: "marvel-hqs", entry: cbr, listing, genreId: "g1" }),
      (error: unknown) => error instanceof CollectionFormatUnsupportedError && error.format === "cbr");
  });
  it("um item de formato desconhecido também é recusado", async () => {
    const { service } = environment();
    const unknown = comic({ name: "notas", mimeType: "application/octet-stream", format: "unknown", supported: false, contentType: undefined });
    await assert.rejects(() => service.add({ collectionId: "marvel-hqs", entry: unknown, listing, genreId: "g1" }), CollectionFormatUnsupportedError);
  });
  it("nada é baixado quando o formato não é suportado", async () => {
    const { service, downloaded } = environment();
    const cbr = comic({ format: "cbr", supported: false });
    await service.add({ collectionId: "marvel-hqs", entry: cbr, listing, genreId: "g1" }).catch(() => undefined);
    assert.deepEqual(downloaded, []);
  });
});
