import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { IndexedDbService } from "../src/services/IndexedDbService";
import { BookRepository } from "../src/repositories/BookRepository";
import { BookFileRepository } from "../src/repositories/BookFileRepository";
import { LimaDocumentRepository } from "../src/repositories/LimaDocumentRepository";
import { GenreRepository } from "../src/repositories/GenreRepository";
import { LocalBookFileStore } from "../src/services/LocalBookFileStore";
import { PersistentLibraryManager } from "../src/services/PersistentLibraryManager";
import { LibraryBootstrapService } from "../src/services/LibraryBootstrapService";
import { LibraryReconciliationService } from "../src/services/LibraryReconciliationService";
import { StoragePersistenceService } from "../src/services/StoragePersistenceService";
import { LibraryChecksumRepository } from "../src/repositories/LibraryChecksumRepository";
import { LimaDocumentFactory } from "../src/lima/LimaDocumentFactory";
import { Book } from "../src/models/Book";
import { Genre } from "../src/models/Genre";
import { Library } from "../src/models/Library";
import { readFileSync } from "node:fs";

Object.assign(globalThis, { indexedDB, IDBKeyRange });
const book = () => new Book({ id: "book-1", title: "Livro", author: "Autor", genreId: "g", cover: "cover", fileType: "pdf", fileName: "book.pdf", fileSize: 3, mimeType: "application/pdf", readingStatus: "unread" });
function setup(name = `persistent-${crypto.randomUUID()}`) { const db = new IndexedDbService(name), books = new BookRepository(db), fallback = new BookFileRepository(db), files = new LocalBookFileStore(fallback), documents = new LimaDocumentRepository(db); return { db, books, fallback, files, documents, manager: new PersistentLibraryManager(books, files, documents) }; }

describe("Biblioteca local persistente", () => {
  it("livros e HQs conservam arquivo, capa e gênero ao limpar a sessão visual e reabrir a mesma conta", async () => {
    const name = `lumeo-library-${crypto.randomUUID()}`, current = setup(name);
    const genres = new GenreRepository(current.db);
    await genres.save(new Genre("g", "Livros"));
    await genres.save(new Genre("hq", "HQs"));
    const comic = new Book({ id: "comic-1", title: "HQ", author: "Autor", genreId: "hq", cover: "comic-cover", fileType: "pdf", fileName: "comic.pdf", fileSize: 3, mimeType: "application/pdf", readingStatus: "unread", contentType: "comic" });
    await current.manager.persistBook(book(), new Blob(["pdf"]));
    await current.manager.persistBook(comic, new Blob(["hq!"]));
    const visible = new Library();
    for (let cycle = 0; cycle < 3; cycle++) {
      // Logout discards only the in-memory view, never the account's repositories.
      visible.replaceBooks([]); visible.replaceGenres([]);
      const reopened = setup(name);
      const restored = await new LibraryBootstrapService(new GenreRepository(reopened.db), reopened.manager).restore();
      visible.replaceBooks(restored.books); visible.replaceGenres(restored.genres);
      assert.equal(visible.findBooksByGenre("g").length, 1);
      assert.equal(visible.findBooksByGenre("hq").length, 1);
      assert.equal(visible.findBooksByGenre("hq")[0].contentType, "comic");
      assert.equal(visible.findBooksByGenre("g")[0].cover, "cover");
      assert.equal(await (await reopened.files.get("book-1"))?.text(), "pdf");
      assert.equal(await (await reopened.files.get("comic-1"))?.text(), "hq!");
    }
    assert.equal((await setup(`${name}-other-user`).books.getAll()).length, 0);
  });
  it("a prateleira permite alcançar verticalmente livros abaixo das HQs sem perder o carrossel", () => {
    const css = readFileSync(new URL("../src/styles/library.css", import.meta.url), "utf8");
    const rule = css.match(/\.genre-shelf \.book-shelf__viewport\{([^}]+)\}/)?.[1] ?? "";
    assert.match(rule, /touch-action:pan-x pan-y pinch-zoom/);
    assert.match(rule, /overflow-x:auto/);
    assert.match(rule, /scroll-snap-type:x proximity/);
  });
  it("persistBook e restoreAfterReload", async () => { const name = `reload-${crypto.randomUUID()}`, first = setup(name); await first.manager.persistBook(book(), new Blob(["pdf"])); const reopened = setup(name), restored = await reopened.manager.restoreLibrary(); assert.equal(restored.books[0]?.id, "book-1"); assert.equal((await reopened.files.get("book-1"))?.size, 3); });
  it("restoreAfterRestart e offlineOpen usam armazenamento local", async () => { const current = setup(); await current.manager.persistBook(book(), new Blob(["pdf"])); assert.equal((await current.manager.restoreLibrary()).integrity[0]?.state, "VALID"); });
  it("missingFile", () => assert.equal(new LibraryReconciliationService().inspect(book(), false, null).state, "MISSING_FILE"));
  it("duplicateLima", () => { const reconciliation = new LibraryReconciliationService(), fake = { manifest: { documentId: "same" } } as never; assert.equal(reconciliation.deduplicate([fake, fake]).length, 1); });
  it("orphanFile e invalidLima", () => { const service=new LibraryReconciliationService(),document=new LimaDocumentFactory().create({file:new File([""],"a.pdf"),id:"orphan",title:"Órfão",author:"Autor"},"pdf",[],[]);assert.equal(service.inspect(null,false,document).state,"ORPHAN_FILE");const invalid={...document,manifest:{...document.manifest,format:"wrong"}}as never;assert.equal(service.inspect(null,false,invalid).state,"INVALID_LIMA"); });
  it("storageFallback", async () => { const current = setup(); assert.equal(await current.files.save("b", new Blob(["x"])), "indexeddb"); assert.equal(await current.fallback.exists("b"), true); });
  it("LibraryBootstrapService", async () => { const current = setup(); await current.manager.persistBook(book(), new Blob(["pdf"])); const result = await new LibraryBootstrapService(new GenreRepository(current.db), current.manager).restore(); assert.equal(result.books.length, 1); });
  it("StoragePersistenceService tolera API indisponível", async () => { const status = await new StoragePersistenceService().status(); assert.equal(typeof status.persistent, "boolean"); });
  it("checksum SHA-256 e persistência do índice",async()=>{const current=setup(),checksum=await current.manager.checksum(new Blob(["lumeo"])),repository=new LibraryChecksumRepository(current.db);await repository.save({bookId:"b",source:checksum});assert.equal((await repository.get("b"))?.source,checksum);assert.equal(checksum.length,64);});
  it("migrationKeepsBooks conserva Blob legado",async()=>{const current=setup();await current.fallback.save("legacy",new Blob(["old"]));await current.files.migrateExisting("legacy");assert.equal(await current.fallback.exists("legacy"),true);});
});
