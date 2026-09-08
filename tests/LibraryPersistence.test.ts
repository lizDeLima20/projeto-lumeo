import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { strToU8, zipSync } from "fflate";
import { LocalFileImporter, UnsupportedFileError } from "../src/importers/LocalFileImporter";
import { Book } from "../src/models/Book";
import { Genre } from "../src/models/Genre";
import { BookFileRepository } from "../src/repositories/BookFileRepository";
import { BookRepository } from "../src/repositories/BookRepository";
import { GenreRepository } from "../src/repositories/GenreRepository";
import { ReadingProgressRepository } from "../src/repositories/ReadingProgressRepository";
import { HighlightRepository } from "../src/repositories/HighlightRepository";
import { AnnotationRepository } from "../src/repositories/AnnotationRepository";
import { BookmarkRepository } from "../src/repositories/BookmarkRepository";
import { ChapterStudySheetRepository } from "../src/repositories/ChapterStudySheetRepository";
import { LibraryChecksumRepository } from "../src/repositories/LibraryChecksumRepository";
import { ImportManager } from "../src/services/ImportManager";
import { BookVersionConflictError, DuplicateBookImportError } from "../src/services/ImportManager";
import { IndexedDbService } from "../src/services/IndexedDbService";
import { LibraryService } from "../src/services/LibraryService";
import { DuplicateBookDetector } from "../src/storage/DuplicateBookDetector";
import { BookSeriesResolver } from "../src/components/BookSeriesResolver";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

function repositories(name = `lumeo-test-${crypto.randomUUID()}`): {
  books: BookRepository; genres: GenreRepository; files: BookFileRepository; databaseName: string;
} {
  const database = new IndexedDbService(name);
  return { books: new BookRepository(database), genres: new GenreRepository(database), files: new BookFileRepository(database), databaseName: name };
}

function sampleBook(genreId = "genre-1"): Book {
  return new Book({ id: "book-1", title: "Livro teste", author: "Autora", genreId, cover: "", fileType: "pdf",
    fileName: "livro.pdf", fileSize: 4, mimeType: "application/pdf", readingStatus: "unread" });
}

describe("repositórios IndexedDB", () => {
  it("saveBook e loadBook persistem metadados após reabrir", async () => {
    const first = repositories(); await first.books.save(sampleBook());
    const reopened = new BookRepository(new IndexedDbService(first.databaseName));
    const loaded = await reopened.get("book-1");
    assert.equal(loaded?.title, "Livro teste"); assert.ok(loaded?.createdAt instanceof Date);
  });

  it("saveFile, loadFile e deleteFile preservam e removem o Blob", async () => {
    const { files } = repositories(); const blob = new Blob(["%PDF"], { type: "application/pdf" });
    await files.save("book-1", blob); assert.equal(await (await files.get("book-1"))?.text(), "%PDF");
    assert.equal(await files.exists("book-1"), true); await files.delete("book-1");
    assert.equal(await files.exists("book-1"), false);
  });

  it("deleteBook remove os metadados", async () => {
    const { books } = repositories(); await books.save(sampleBook()); await books.delete("book-1");
    assert.equal(await books.get("book-1"), null);
  });

  it("createGenre e assignGenre", async () => {
    const { books, genres } = repositories(); const genre = new Genre("genre-2", "Poesia");
    await genres.save(genre); assert.equal((await genres.getAll())[0]?.name, "Poesia");
    await books.save(sampleBook(genre.id)); assert.equal((await books.getByGenre(genre.id))[0]?.genreId, genre.id);
  });

  it("edita metadados, troca gênero e exclui metadados, Blob e progresso", async () => {
    const database = new IndexedDbService(`lumeo-test-${crypto.randomUUID()}`);
    const books = new BookRepository(database); const files = new BookFileRepository(database);
    const progress = new ReadingProgressRepository(database); const service = new LibraryService(books, files, progress);
    const original = sampleBook(); await books.save(original); await files.save(original.id, new Blob(["%PDF"]));
    await progress.save({ bookId: original.id, currentPage: 2, totalPages: 10, progressPercent: 20, updatedAt: new Date().toISOString() });
    const edited = new Book({ id: original.id, title: "Título editado", author: original.author, genreId: "genre-2",
      cover: original.cover, fileType: original.fileType, fileName: original.fileName, fileSize: original.fileSize,
      mimeType: original.mimeType, readingStatus: "reading", createdAt: original.createdAt, updatedAt: new Date() });
    await service.saveBook(edited);
    assert.equal((await books.get(original.id))?.genreId, "genre-2"); assert.equal(await files.exists(original.id), true);
    await service.deleteBook(original.id);
    assert.equal(await books.get(original.id), null); assert.equal(await files.exists(original.id), false);
    assert.equal(await progress.get(original.id), null);
  });

  it("deleteBook remove somente os dados vinculados ao livro escolhido", async () => {
    const database = new IndexedDbService(`lumeo-test-${crypto.randomUUID()}`);
    const books = new BookRepository(database); const files = new BookFileRepository(database); const progress = new ReadingProgressRepository(database);
    const highlights = new HighlightRepository(database); const annotations = new AnnotationRepository(database); const bookmarks = new BookmarkRepository(database);
    const sheets = new ChapterStudySheetRepository(database); const checksums = new LibraryChecksumRepository(database);
    const service = new LibraryService(books, files, progress, [highlights, annotations, bookmarks, sheets, checksums]);
    const target = sampleBook(); const sibling = new Book({ ...sampleBook(), id: "book-2", title: "Livro teste Volume 2", fileName: "vol-2.pdf" });
    await books.save(target); await books.save(sibling); await files.save(target.id, new Blob(["%PDF"])); await files.save(sibling.id, new Blob(["%PDF2"]));
    await progress.save({ bookId: target.id, currentPage: 2, totalPages: 10, progressPercent: 20, updatedAt: new Date().toISOString() });
    await progress.save({ bookId: sibling.id, currentPage: 1, totalPages: 10, progressPercent: 10, updatedAt: new Date().toISOString() });
    await highlights.save({ id: "h1", bookId: target.id, blockId: "b1", startOffset: 0, endOffset: 4, selectedText: "texto", color: "yellow", createdAt: "now", updatedAt: "now" });
    await annotations.save({ id: "a1", bookId: target.id, highlightId: "h1", text: "nota", createdAt: "now", updatedAt: "now" });
    await bookmarks.save({ id: "m1", bookId: target.id, anchor: { paragraphId: "p1", textOffset: 0, logicalOffset: 0 }, createdAt: "now" });
    await sheets.save({ id: "s1", userId: "u1", bookId: target.id, chapterId: "c1", summary: "", topics: [], questions: [], doubts: [], createdAt: "now", updatedAt: "now" });
    await checksums.save({ bookId: target.id, source: "hash-target" }); await checksums.save({ bookId: sibling.id, source: "hash-sibling" });
    await service.deleteBook(target.id);
    assert.equal(await books.get(target.id), null); assert.equal(await files.exists(target.id), false); assert.equal(await progress.get(target.id), null);
    assert.deepEqual(await highlights.byBook(target.id), []); assert.deepEqual(await annotations.byBook(target.id), []); assert.deepEqual(await bookmarks.byBook(target.id), []);
    assert.equal(await checksums.get(target.id), null); assert.equal((await sheets.byBook("u1", target.id)).length, 0);
    assert.equal((await books.get(sibling.id))?.id, sibling.id); assert.equal(await files.exists(sibling.id), true); assert.equal((await progress.get(sibling.id))?.progressPercent, 10);
    assert.equal((await checksums.get(sibling.id))?.source, "hash-sibling");
  });
});

describe("ImportManager", () => {
  it("importa PDF e EPUB e salva arquivo e metadados", async () => {
    for (const [name, mime] of [["teste.pdf", "application/pdf"], ["teste.epub", "application/epub+zip"]] as const) {
      const { books, files } = repositories(); const manager = new ImportManager(new LocalFileImporter(), books, files);
      const content = name.endsWith(".pdf") ? "%PDF-1.4\n%%EOF" : new Uint8Array(zipSync({ "META-INF/container.xml": strToU8("<container/>") })).buffer;
      const imported = await manager.select(new File([content], name, { type: mime }));
      const book = await manager.save(imported, { title: imported.suggestedTitle, author: "", genreId: "genre-1", readingStatus: "unread", cover: "" });
      assert.equal((await books.get(book.id))?.fileType, name.endsWith("pdf") ? "pdf" : "epub");
      assert.equal(await files.exists(book.id), true);
    }
  });

  it("unsupportedFileRejected", async () => {
    const manager = new ImportManager(new LocalFileImporter(), repositories().books, repositories().files);
    await assert.rejects(() => manager.select(new File(["text"], "notas.txt", { type: "text/plain" })), UnsupportedFileError);
  });

  it("bloqueia importação duplicada pelo hash do arquivo", async () => {
    const database = new IndexedDbService(`lumeo-test-${crypto.randomUUID()}`);
    const books = new BookRepository(database); const files = new BookFileRepository(database);
    const manager = new ImportManager(new LocalFileImporter(), books, files, undefined, undefined, undefined, undefined, new LibraryChecksumRepository(database));
    const first = await manager.select(new File(["%PDF-1.4 duplicado"], "a.pdf", { type: "application/pdf" }));
    await manager.save(first, { title: "Mesmo livro", author: "Autor", genreId: "genre-1", readingStatus: "unread", cover: "" });
    const second = await manager.select(new File(["%PDF-1.4 duplicado"], "nome-diferente.pdf", { type: "application/pdf" }));
    await assert.rejects(() => manager.save(second, { title: "Mesmo livro", author: "Autor", genreId: "genre-1", readingStatus: "unread", cover: "" }), DuplicateBookImportError);
  });

  it("permite volumes diferentes da mesma obra e ordena lado a lado", async () => {
    const detector = new DuplicateBookDetector(), resolver = new BookSeriesResolver();
    const existing = [new Book({ ...sampleBook(), id: "v1", title: "Obra Volume 1", author: "Autor", fileName: "v1.pdf", fileSize: 10 })];
    const decision = detector.classify(existing, new Map([["v1", "hash-v1"]]), {
      title: "Obra Volume 2", author: "Autor", fileName: "v2.pdf", fileSize: 12, hash: "hash-v2",
    });
    assert.equal(decision.kind, "same-series-volume");
    const ordered = resolver.order([...existing, new Book({ ...sampleBook(), id: "v2", title: "Obra Volume 2", author: "Autor" })]);
    assert.deepEqual(ordered.map(book => book.id), ["v1", "v2"]);
  });

  it("avisa possível edição diferente sem substituir automaticamente", async () => {
    const database = new IndexedDbService(`lumeo-test-${crypto.randomUUID()}`);
    const books = new BookRepository(database); const files = new BookFileRepository(database); const checksums = new LibraryChecksumRepository(database);
    const manager = new ImportManager(new LocalFileImporter(), books, files, undefined, undefined, undefined, undefined, checksums);
    await manager.save(await manager.select(new File(["%PDF-1.4 primeira"], "livro.pdf", { type: "application/pdf" })),
      { title: "Mesmo título", author: "Autor", genreId: "genre-1", readingStatus: "unread", cover: "" });
    const other = await manager.select(new File(["%PDF-1.4 outra edicao"], "livro-2026.pdf", { type: "application/pdf" }));
    await assert.rejects(() => manager.save(other, { title: "Mesmo título", author: "Autor", genreId: "genre-1", readingStatus: "unread", cover: "" }), BookVersionConflictError);
    await assert.doesNotReject(() => manager.save(other, { title: "Mesmo título", author: "Autor", genreId: "genre-1", readingStatus: "unread", cover: "" }, undefined, { allowPossibleVersion: true }));
  });
});
