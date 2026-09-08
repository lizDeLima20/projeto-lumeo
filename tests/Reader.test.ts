import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { Book } from "../src/models/Book";
import { ReaderNavigationController } from "../src/reader/ReaderNavigationController";
import { ReaderSettingsManager } from "../src/reader/ReaderSettingsManager";
import { ReadingProgressService } from "../src/reader/ReadingProgressService";
import { BookRepository } from "../src/repositories/BookRepository";
import { ReadingProgressRepository } from "../src/repositories/ReadingProgressRepository";
import { IndexedDbService } from "../src/services/IndexedDbService";
import { StorageService } from "../src/services/StorageService";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

describe("ReaderNavigationController", () => {
  it("openFirstPage e restoreSavedPage", async () => {
    const visited: number[] = []; const navigation = new ReaderNavigationController(10, (page) => { visited.push(page); });
    await navigation.initialize(); assert.equal(navigation.currentPage, 1);
    await navigation.initialize(6); assert.equal(navigation.currentPage, 6); assert.deepEqual(visited, [1, 6]);
  });
  it("nextPage e previousPage", async () => {
    const navigation = new ReaderNavigationController(5, () => undefined); await navigation.initialize(2);
    await navigation.nextPage(); assert.equal(navigation.currentPage, 3);
    await navigation.previousPage(); assert.equal(navigation.currentPage, 2);
  });
  it("preventPageZero e preventBeyondLastPage", async () => {
    const navigation = new ReaderNavigationController(2, () => undefined); await navigation.initialize();
    await navigation.previousPage(); assert.equal(navigation.currentPage, 1);
    await navigation.nextPage(); await navigation.nextPage(); assert.equal(navigation.currentPage, 2);
    await assert.rejects(() => navigation.goToPage(0)); await assert.rejects(() => navigation.goToPage(3));
  });
  it("goToPage", async () => {
    const navigation = new ReaderNavigationController(20, () => undefined); await navigation.initialize();
    await navigation.goToPage(14); assert.equal(navigation.currentPage, 14);
  });
});

describe("ReadingProgressService", () => {
  function setup(): { service: ReadingProgressService; books: BookRepository; book: Book } {
    const database = new IndexedDbService(`reader-test-${crypto.randomUUID()}`); const books = new BookRepository(database);
    const book = new Book({ id: crypto.randomUUID(), title: "PDF teste", author: "Lumeo", genreId: "test", cover: "",
      fileType: "pdf", fileName: "teste.pdf", fileSize: 100, mimeType: "application/pdf", readingStatus: "unread" });
    return { service: new ReadingProgressService(new ReadingProgressRepository(database), books), books, book };
  }
  it("saveProgress, calculateProgress, restoreProgress e markReading", async () => {
    const { service, book } = setup(); const updated = await service.saveProgress(book, 3, 10, false);
    assert.equal(service.calculateProgress(3, 10), 30); assert.equal(updated.readingStatus, "reading");
    const restored = await service.restoreProgress(book.id); assert.equal(restored?.currentPage, 3); assert.equal(restored?.totalPages, 10);
  });
  it("markFinished somente ao chegar ao fim avançando", async () => {
    const { service, book } = setup();
    const direct = await service.saveProgress(book, 10, 10, false); assert.equal(direct.readingStatus, "reading");
    const finished = await service.saveProgress(direct, 10, 10, true); assert.equal(finished.readingStatus, "finished");
  });
});

describe("ReaderSettingsManager", () => {
  it("zoomIn, zoomOut e zoomLimits", async () => {
    const settings = new ReaderSettingsManager(new StorageService()); await settings.initialize("light");
    assert.equal(await settings.zoomIn(), 110); assert.equal(await settings.zoomOut(), 100);
    assert.equal(await settings.setZoom(999), 300); assert.equal(await settings.zoomIn(), 300);
    assert.equal(await settings.setZoom(1), 50); assert.equal(await settings.zoomOut(), 50);
  });
  it("fitWidth e fitPage persistem o modo", async () => {
    const storage = new StorageService(); const settings = new ReaderSettingsManager(storage); await settings.initialize("dark");
    await settings.fitWidth(); assert.equal(settings.settings.fitMode, "width");
    await settings.fitPage(); assert.equal(settings.settings.fitMode, "page");
    const restored = new ReaderSettingsManager(storage); await restored.initialize("light"); assert.equal(restored.settings.fitMode, "page");
  });
});

describe("Reader chrome minimal", () => {
  it("readerToolbarUsesOnlyPersistentSettingsGear", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/views/ReaderToolbar.ts", import.meta.url), "utf8"));
    assert.match(source, /reader-settings-fab/);
    assert.match(source, /reader-back-fab/);
    assert.doesNotMatch(source, /createElement\("header", "reader-toolbar"\)/);
    assert.doesNotMatch(source, /createElement\("footer", "reader-footer"\)/);
  });
  it("neutralPageTapDoesNotOpenControls", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/views/ReaderView.ts", import.meta.url), "utf8"));
    assert.match(source, /reader-tap-zone--center", this\.i18n\.t\("reader\.toggleControls"\), \(\) => undefined/);
    assert.doesNotMatch(source, /neutralTap\(\)/);
  });
  it("coverOpeningShowsOnlyCoverImageWithoutGeneratedTitle", async () => {
    const page = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/views/BookPageView.ts", import.meta.url), "utf8"));
    const reader = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/views/ReaderView.ts", import.meta.url), "utf8"));
    assert.match(page, /reader-cover-page/);
    assert.doesNotMatch(page, /frame\.append\(title, author\)/);
    assert.doesNotMatch(reader, /frame\.append\(this\.createElement\("strong"/);
  });
});
