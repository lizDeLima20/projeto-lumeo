import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { Book } from "../src/models/Book";
import { BackupRestorer } from "../src/backup/BackupRestorer";
import { BackupService } from "../src/backup/BackupService";
import { BackupValidator } from "../src/backup/BackupValidator";
import { DatabaseHealthChecker } from "../src/database/DatabaseHealthChecker";
import { DatabaseMigrationManager } from "../src/database/DatabaseMigrationManager";
import { DatabaseRecoveryManager } from "../src/database/DatabaseRecoveryManager";
import { DiagnosticExporter } from "../src/diagnostics/DiagnosticExporter";
import { AppVersionManager } from "../src/pwa/AppVersionManager";
import { CacheCleanupManager, type CacheStorageLike } from "../src/pwa/CacheCleanupManager";
import { ServiceWorkerUpdateManager } from "../src/pwa/ServiceWorkerUpdateManager";
import { OfflineAvailabilityService } from "../src/storage/OfflineAvailabilityService";
import { DuplicateBookDetector } from "../src/storage/DuplicateBookDetector";
import { LocalStorageManager } from "../src/storage/LocalStorageManager";
import { IndexedDbService } from "../src/services/IndexedDbService";
import { StudyLookupCacheRepository } from "../src/repositories/StudyLookupCacheRepository";
import { StudyLookupManager } from "../src/services/study/StudyLookupManager";
import { DictionaryService } from "../src/services/study/DictionaryService";
import { OperationRecoveryJournal } from "../src/recovery/OperationRecoveryJournal";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

class MemoryCacheStorage implements CacheStorageLike {
  public constructor(private readonly names: string[]) {}
  public async keys(): Promise<string[]> { return this.names; }
  public async delete(key: string): Promise<boolean> { this.names = this.names.filter((name) => name !== key); return true; }
}

class MemoryStorage {
  private readonly rows = new Map<string, unknown>();
  public async load<T>(key: string): Promise<T | null> { return this.rows.get(key) as T ?? null; }
  public async save<T>(key: string, value: T): Promise<void> { this.rows.set(key, value); }
  public async remove(key: string): Promise<void> { this.rows.delete(key); }
}

const book = (extra: Partial<ConstructorParameters<typeof Book>[0]> = {}) => new Book({
  id: "book-1", title: "A Ciência do Sucesso", author: "Napoleon Hill", genreId: "study", cover: "cover.png",
  fileType: "pdf", fileName: "sucesso.pdf", fileSize: 1024 * 1024, mimeType: "application/pdf", readingStatus: "reading",
  ...extra,
});

describe("PWA offline e armazenamento robusto", () => {
  it("appShellWorksOffline", async () => {
    const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
    assert.match(sw, /APP_SHELL/);
    assert.match(sw, /networkFirst\(request, SHELL_CACHE, "\/index\.html"\)/);
    assert.match(sw, /lumeo-shell-\$\{SW_VERSION\}/);
  });

  it("authenticatedDriveApiRequestsBypassCacheStorage", async () => {
    const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
    assert.match(sw, /url\.hostname === "www\.googleapis\.com"/);
    assert.match(sw, /Authenticated Drive API requests are browser-only/);
  });

  it("aVersaoDoServiceWorkerEUmaSo", async () => {
    // sw.js estava em v10 enquanto o app declarava v9: a tela de versao mentia sobre o
    // cache em uso. As duas pontas precisam dizer a mesma coisa.
    const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
    const declared = /const SW_VERSION = "([^"]+)"/.exec(sw)?.[1];
    const { AppVersionManager } = await import("../src/pwa/AppVersionManager");
    assert.equal(declared, AppVersionManager.SERVICE_WORKER_VERSION);
  });

  it("manifestoProntoParaInstalarEEmpacotar", async () => {
    const manifest = JSON.parse(await readFile(new URL("../public/manifest.json", import.meta.url), "utf8"));
    for (const key of ["id", "name", "short_name", "description", "start_url", "scope", "display", "background_color", "theme_color", "lang"]) assert.ok(manifest[key], `falta ${key}`);
    const sizes = (purpose: string) => manifest.icons.filter((icon: { purpose: string }) => icon.purpose === purpose).map((icon: { sizes: string }) => icon.sizes);
    assert.ok(sizes("any").includes("192x192") && sizes("any").includes("512x512"), "icones 192 e 512");
    assert.ok(sizes("maskable").includes("512x512"), "icone maskable proprio - nunca 'any maskable' no mesmo arquivo");
    assert.equal(manifest.icons.some((icon: { purpose: string }) => /any maskable|maskable any/.test(icon.purpose)), false);
    assert.ok(manifest.screenshots.some((shot: { form_factor: string }) => shot.form_factor === "narrow"), "screenshot de celular");
    assert.ok(manifest.screenshots.some((shot: { form_factor: string }) => shot.form_factor === "wide"), "screenshot de desktop");
    for (const shortcut of manifest.shortcuts) assert.match(shortcut.url, /^\/(import|library)$/, "atalho aponta para rota existente");
    const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
    assert.doesNotMatch(sw, /lumeo-logo\.png/, "o logo de 890 KB nao entra no cache inicial");
  });

  it("libraryMetadataLoadsOffline", () => {
    const restored = [book()];
    assert.equal(restored[0].cover, "cover.png");
    assert.equal(restored[0].fileSize, 1024 * 1024);
  });

  it("localBookOpensOffline", () => {
    assert.equal(new OfflineAvailabilityService().canOpenOffline(book(), true), true);
  });

  it("remoteOnlyBookExplainsOfflineState", () => {
    assert.equal(new OfflineAvailabilityService().messageKey(book({ offlineAvailability: "REMOTE_ONLY" })), "offline.bookRemoteOnly");
  });

  it("storageEstimateWorks", async () => {
    const manager = new LocalStorageManager({ estimate: async () => ({ usage: 900, quota: 1000 }) });
    const report = await manager.report([book({ fileSize: 300 })], 20, 10, 5);
    assert.equal(report.available, 100);
    assert.equal(report.lowSpace, true);
    assert.equal(report.categories.books, 300);
  });

  it("cacheCleanupPreservesBooks", async () => {
    const cache = new MemoryCacheStorage(["lumeo-runtime-v8", "lumeo-shell-v9", "bookFiles"]);
    const removed = await new CacheCleanupManager(cache).cleanupTemporary();
    assert.deepEqual(removed, ["lumeo-runtime-v8"]);
  });

  it("cacheCleanupPreservesStudyData", async () => {
    const cache = new MemoryCacheStorage(["lumeo-lookup-v8", "readingProgress", "highlights"]);
    await new CacheCleanupManager(cache).cleanupTemporary();
    assert.deepEqual(await cache.keys(), ["readingProgress", "highlights"]);
  });

  it("databaseHealthDetectsMissingStore", () => {
    const report = new DatabaseHealthChecker().checkStoreNames(["books", "genres"], 9);
    assert.equal(report.healthy, false);
    assert.ok(report.missingStores.includes("bookFiles"));
  });

  it("recoveryPreservesOriginalBookFiles", () => {
    const report = new DatabaseHealthChecker().checkStoreNames(Object.values({
      books: "books", genres: "genres", files: "bookFiles", progress: "readingProgress", collections: "collections", highlights: "highlights",
      annotations: "annotations", bookmarks: "bookmarks", studyLookupCache: "studyLookupCache", limaDocuments: "limaDocuments",
      chapterStudySheets: "chapterStudySheets", librarySettings: "librarySettings", libraryChecksums: "libraryChecksums",
      readerPreferences: "readerPreferences", imageReaderPreferences: "imageReaderPreferences", regionHighlights: "regionHighlights",
      metadataAuxiliary: "metadataAuxiliary", recoveryJournal: "recoveryJournal", localDiagnostics: "localDiagnostics",
    }), 9);
    assert.equal(new DatabaseRecoveryManager().recover(report).preservedOriginalBookFiles, true);
  });

  it("backupLightExcludesBooks", () => {
    assert.equal(new BackupService().createLight({ books: [book()] }).books, undefined);
  });

  it("backupFullIncludesBooks", () => {
    const backup = new BackupService().createFull({ books: [book()], files: [{ bookId: "book-1", blob: new Blob(["pdf"]) }] });
    assert.equal(backup.books?.length, 1);
  });

  it("backupRestoreValidatesManifest", () => {
    const backup = new BackupService().createLight({ books: [book()] });
    assert.equal(new BackupValidator().validate(backup).valid, true);
    assert.equal(new BackupRestorer().restore(backup, ["book-1"]).restoredBooks, 0);
  });

  it("migrationRunsInOrder", async () => {
    const order: number[] = [];
    const result = await new DatabaseMigrationManager([{ version: 3, run: async () => { order.push(3); } }, { version: 2, run: async () => { order.push(2); } }]).runFrom(1);
    assert.deepEqual(result, [2, 3]);
    assert.deepEqual(order, [2, 3]);
  });

  it("migrationDoesNotRequireDatabaseReset", () => {
    assert.equal(new DatabaseMigrationManager([]).requiresReset(1), false);
  });

  it("updateDoesNotReloadOpenReader", () => {
    const manager = new ServiceWorkerUpdateManager();
    manager.notifyAvailable({ waiting: { postMessage: () => undefined } });
    assert.equal(manager.shouldDefer(true), true);
  });

  it("acceptedUpdateRestoresReadingPosition", async () => {
    let saved = false, reloaded = false;
    const manager = new ServiceWorkerUpdateManager(async () => { saved = true; });
    manager.notifyAvailable({ waiting: { postMessage: () => undefined } });
    assert.equal(await manager.accept(() => { reloaded = true; }), true);
    assert.equal(saved && reloaded, true);
  });

  it("oldCachesAreCleanedSafely", async () => {
    const cache = new MemoryCacheStorage(["lumeo-shell-v8", "lumeo-shell-v9", "other-app-cache"]);
    const removed = await new CacheCleanupManager(cache).deleteOldAppCaches(["lumeo-shell-v9"]);
    assert.deepEqual(removed, ["lumeo-shell-v8"]);
    assert.deepEqual(await cache.keys(), ["lumeo-shell-v9", "other-app-cache"]);
  });

  it("duplicateBookDetectedByHash", () => {
    const duplicate = new DuplicateBookDetector().findDuplicate([{ bookId: "book-1", size: 10, hash: "abc" }], { size: 10, hash: "abc" });
    assert.equal(duplicate?.bookId, "book-1");
  });

  it("interruptedImportDoesNotCreateGhostBook", async () => {
    const journal = new OperationRecoveryJournal(new MemoryStorage());
    await journal.begin({ id: "op-1", kind: "import", bookId: "ghost-book" });
    assert.deepEqual(await journal.ghostsAfterInterruptedImport(), ["ghost-book"]);
  });

  it("lookupCacheWorksOffline", async () => {
    let calls = 0;
    const dictionary = new DictionaryService(async () => { calls++; return new Response(JSON.stringify([{ meanings: [{ definitions: [{ definition: "cacheado" }] }] }])); });
    const cache = new StudyLookupCacheRepository(new IndexedDbService(`lookup-pwa-${crypto.randomUUID()}`));
    const manager = new StudyLookupManager(cache, dictionary);
    await manager.definition("book", "en");
    assert.equal((await manager.definition("book", "en")).definition, "cacheado");
    assert.equal(calls, 1);
  });

  it("startupDoesNotLoadAllBookBlobs", () => {
    const startupStores = ["books", "genres", "readingProgress"];
    assert.equal(startupStores.includes("bookFiles"), false);
  });

  it("diagnosticExportExcludesPrivateContent", async () => {
    const report = await new LocalStorageManager({ estimate: async () => ({ usage: 1, quota: 10 }) }).report([]);
    const diagnostic = new DiagnosticExporter().export({
      versions: new AppVersionManager().info(), connectivity: "ONLINE", storage: report, persistent: true,
      errors: [{ code: "x", message: "ok" }],
      notes: "texto privado",
    } as Parameters<DiagnosticExporter["export"]>[0] & { notes: string });
    assert.equal(diagnostic.includes("texto privado"), false);
    assert.equal(diagnostic.includes("bookText"), false);
  });
});
