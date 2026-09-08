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

Object.assign(globalThis, { indexedDB, IDBKeyRange });
const book = () => new Book({ id: "book-1", title: "Livro", author: "Autor", genreId: "g", cover: "cover", fileType: "pdf", fileName: "book.pdf", fileSize: 3, mimeType: "application/pdf", readingStatus: "unread" });
function setup(name = `persistent-${crypto.randomUUID()}`) { const db = new IndexedDbService(name), books = new BookRepository(db), fallback = new BookFileRepository(db), files = new LocalBookFileStore(fallback), documents = new LimaDocumentRepository(db); return { db, books, fallback, files, documents, manager: new PersistentLibraryManager(books, files, documents) }; }

describe("Biblioteca local persistente", () => {
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
