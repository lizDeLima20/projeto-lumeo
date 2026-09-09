import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { OneDriveSourceRepository } from "../src/external/OneDriveSourceRepository";
import { ExternalLibraryStorage } from "../src/external/ExternalLibraryStorage";
import { OneDriveFolderResolver } from "../src/external/OneDriveFolderResolver";
import { OneDriveBrowserService } from "../src/external/OneDriveBrowserService";
import { OneDriveGraphClient } from "../src/external/OneDriveGraphClient";
import { OneDriveDownloadService } from "../src/external/OneDriveDownloadService";
import { OneDriveImportCoordinator } from "../src/external/OneDriveImportCoordinator";
import { OneDriveError } from "../src/external/OneDriveError";
import { OneDriveAuthManager } from "../src/external/OneDriveAuthManager";
import { IndexedDbService, STORE_NAMES } from "../src/services/IndexedDbService";
import { BookRepository } from "../src/repositories/BookRepository";
import { BookFileRepository } from "../src/repositories/BookFileRepository";
import { LibraryChecksumRepository } from "../src/repositories/LibraryChecksumRepository";
import { LocalBookFileStore } from "../src/services/LocalBookFileStore";
import { ImportManager, DuplicateBookImportError } from "../src/services/ImportManager";
import { LocalFileImporter } from "../src/importers/LocalFileImporter";
import { BookMetadataExtractor } from "../src/metadata/BookMetadataExtractor";
import type { CoverService } from "../src/services/CoverService";
import { OperationRecoveryJournal } from "../src/recovery/OperationRecoveryJournal";
import type { StorageAdapter } from "../src/services/StorageService";

Object.assign(globalThis, { indexedDB, IDBKeyRange });
const link = "https://1drv.ms/f/safe-sharing-link";
const pdf = "%PDF-1.7\nlocal-test";
const fileItem = { id: "book-1", name: "meu_livro.pdf", size: pdf.length, file: { mimeType: "application/pdf" },
  "@microsoft.graph.downloadUrl": "https://test.files.1drv.com/content?capability=private" };
const folder = { id: "root", driveId: "drive", name: "Biblioteca" };
const auth = { token: async () => "test-access-token", invalidate: () => undefined };
const matches = (code: string) => (error: unknown): boolean => error instanceof OneDriveError && error.code === code;
function database(): IndexedDbService { return new IndexedDbService(`onedrive-test-${crypto.randomUUID()}`); }
function graph(fetcher: typeof fetch): OneDriveGraphClient { return new OneDriveGraphClient(auth, fetcher); }

describe("OneDrive source configuration", () => {
  it("canCreateOneDriveSource", async () => {
    const repo = new OneDriveSourceRepository(new ExternalLibraryStorage(database()), "user");
    const source = await repo.save("Livros", link);
    assert.equal(source.provider, "ONEDRIVE"); assert.equal(source.userId, "user"); assert.equal(source.enabled, true);
    assert.equal(source.remoteFolderId, null); assert.equal((await repo.all()).length, 1);
  });
  it("canCreateMultipleOneDriveSources", async () => {
    const repo = new OneDriveSourceRepository(new ExternalLibraryStorage(database()), "user");
    await Promise.all([repo.save("Mangás", link), repo.save("Técnica", "https://onedrive.live.com/?id=123&authkey=abc")]);
    assert.equal((await repo.all()).length, 2);
  });
  it("sourcePersists", async () => {
    const db = database(); const repo = new OneDriveSourceRepository(new ExternalLibraryStorage(db), "user");
    const saved = await repo.save("Minha fonte", link);
    assert.deepEqual(await new OneDriveSourceRepository(new ExternalLibraryStorage(db), "user").all(), [saved]);
    assert.equal((await new OneDriveSourceRepository(new ExternalLibraryStorage(db), "other").all()).length, 0);
  });
  it("sourceCanBeRenamed", async () => {
    const repo = new OneDriveSourceRepository(new ExternalLibraryStorage(database()), "user");
    const saved = await repo.save("Antes", link); await repo.resolved(saved.id, "drive/root");
    const renamed = await repo.save("Depois", link, saved.id);
    assert.equal(renamed.id, saved.id); assert.equal(renamed.remoteFolderId, "drive/root");
    assert.equal((await repo.save("Novo link", "https://1drv.ms/f/another", saved.id)).remoteFolderId, null);
  });
  it("sourceCanBeRemovedWithoutDeletingBooks", async () => {
    const db = database(), books = new BookRepository(db), files = new BookFileRepository(db);
    const manager = new ImportManager(new LocalFileImporter(), books, files);
    const imported = await manager.select(new File([pdf], "book.pdf", { type: "application/pdf" }));
    const book = await manager.save(imported, { title: "Livro", author: "", genreId: "g", readingStatus: "unread", cover: "" });
    const repo = new OneDriveSourceRepository(new ExternalLibraryStorage(db), "user");
    const source = await repo.save("Remover", link); await repo.remove(source.id);
    assert.equal((await repo.all()).length, 0); assert.ok(await books.get(book.id)); assert.equal(await (await files.get(book.id))?.text(), pdf);
  });
  it("invalidOneDriveUrlRejected", () => {
    for (const url of ["https://onedrive.live.com.evil.test/x", "http://1drv.ms/f/x", "https://user:pass@1drv.ms/f/x", "javascript:alert(1)", "https://example.com/a", "https://1drv.ms/f/x?access_token=secret"]) {
      assert.throws(() => OneDriveFolderResolver.validateLink(url), matches("onedrive.invalidLink"));
    }
  });
  it("encodesSharingUrlWithoutScrapingOrFollowingTheLink", async () => {
    const client = graph(async (input, init) => {
      const url = new URL(String(input)); assert.equal(url.origin, "https://graph.microsoft.com");
      assert.equal(url.pathname, `/v1.0/shares/${OneDriveFolderResolver.shareId(link)}/driveItem`);
      assert.equal(init?.method, "GET");
      return Response.json({ id: "root", name: "Biblioteca", folder: {}, parentReference: { driveId: "drive" } });
    });
    assert.deepEqual(await new OneDriveFolderResolver(client).resolve(link), folder);
  });
});

describe("OneDrive folder browsing and authorization", () => {
  it("oneDriveFolderCanBeListed", async () => {
    const client = graph(async input => { assert.match(String(input), /drives\/drive\/items\/root\/children/);
      return Response.json({ value: [fileItem, { id: "sub", name: "Subpasta", size: 0, folder: {} }] }); });
    const result = await new OneDriveBrowserService(client).list(folder);
    assert.deepEqual(result.items.map(item => item.id), ["sub", "book-1"]);
  });
  it("supportedFilesAreShown", async () => {
    const client = graph(async () => Response.json({ value: [fileItem, { ...fileItem, id: "e", name: "livro.epub" }] }));
    assert.equal((await new OneDriveBrowserService(client).list(folder)).items.length, 2);
  });
  it("unsupportedFilesAreIgnored", async () => {
    const client = graph(async () => Response.json({ value: [{ ...fileItem, name: "notas.txt" }, { ...fileItem, name: "pacote.lima" }] }));
    const result = await new OneDriveBrowserService(client).list(folder);
    assert.equal(result.items.length, 1); assert.equal(OneDriveBrowserService.supported(result.items[0]!), false);
  });
  it("anonymousRequestIsAttemptedButPrivateFolderRequiresLogin", async () => {
    const client = new OneDriveGraphClient({ token: async () => null, invalidate: () => undefined }, async (_url, init) => {
      assert.equal(new Headers(init?.headers).has("Authorization"), false); return new Response(null, { status: 401 });
    });
    await assert.rejects(() => new OneDriveFolderResolver(client).resolve(link), matches("onedrive.authRequired"));
  });
  it("expiredTokenDoesNotLoopOrOpenPopupAutomatically", async () => {
    let calls = 0, invalidated = false;
    const client = new OneDriveGraphClient({ token: async () => "expired", invalidate: () => { invalidated = true; } }, async () => {
      calls++; return new Response(null, { status: 401 });
    });
    await assert.rejects(() => client.get("me/drive"), matches("onedrive.authRequired")); assert.equal(calls, 1); assert.equal(invalidated, true);
  });
  it("untrustedPaginationNeverReceivesOAuthToken", async () => {
    let called = false;
    const client = graph(async () => { called = true; return Response.json({}); });
    await assert.rejects(() => new OneDriveBrowserService(client).list(folder, undefined, "https://attacker.example/v1.0/children"), matches("onedrive.invalidLink"));
    assert.equal(called, false);
  });
  it("tokensAreNeverLogged", async () => {
    const recorded: unknown[] = []; const original = console.log, warn = console.warn, error = console.error;
    console.log = console.warn = console.error = (...args: unknown[]) => { recorded.push(args); };
    try {
      const client = graph(async () => new Response("sensitive-provider-body", { status: 403 }));
      await assert.rejects(() => client.get("me/drive"), matches("onedrive.denied"));
      assert.equal(recorded.length, 0);
    } finally { console.log = original; console.warn = warn; console.error = error; }
    const source = await readFile(new URL("../src/external/OneDriveAuthManager.ts", import.meta.url), "utf8");
    assert.match(source, /cacheLocation: "memoryStorage"/); assert.match(source, /piiLoggingEnabled: false/);
    assert.deepEqual(OneDriveAuthManager.SCOPES, ["Files.ReadWrite"]);
  });
});

function fixture(download?: OneDriveDownloadService, failSave = false) {
  const db = database(), books = new BookRepository(db), rawFiles = new BookFileRepository(db);
  const files = new LocalBookFileStore(rawFiles), storage = new ExternalLibraryStorage(db), journal = new OperationRecoveryJournal(storage);
  const calls: string[] = [];
  const client = graph(async input => { calls.push(String(input)); return Response.json(fileItem); });
  const downloader = download ?? new OneDriveDownloadService(client, async (_input, init) => {
    assert.equal(new Headers(init?.headers).has("Authorization"), false); assert.equal(init?.credentials, "omit");
    calls.push("download-direct"); return new Response(pdf);
  });
  const manager = new ImportManager(new LocalFileImporter(), books, failSave ? { save: async () => { throw new DOMException("quota", "QuotaExceededError"); }, delete: id => files.delete(id), get: id => files.get(id) } : files,
    undefined, undefined, undefined, undefined, new LibraryChecksumRepository(db));
  const metadata = new BookMetadataExtractor();
  metadata.extract = async () => ({ title: { value: "Meu livro", confidence: "high" }, author: { value: "Autora", confidence: "high" }, sourceText: "" });
  let coverCalls = 0;
  const covers = { fromBookFile: async () => { coverCalls++; return "data:image/png;base64,Y292ZXI="; } } as unknown as CoverService;
  const coordinator = new OneDriveImportCoordinator(downloader, manager, metadata, covers, journal, async () => undefined);
  return { coordinator, books, files, db, journal, calls, coverCalls: () => coverCalls, manager, storage };
}
const importData = { title: "Meu livro", author: "Autora", genreId: "genre", readingStatus: "unread" as const, cover: "data:image/png;base64,Y292ZXI=" };
describe("OneDrive direct import and local persistence", () => {
  it("downloadFeedsImportManager", async () => {
    const f = fixture(); const preview = await f.coordinator.prepare("drive", "book-1", () => undefined);
    assert.equal(preview.imported.source, "onedrive"); assert.equal(preview.imported.fileType, "pdf"); assert.equal(preview.cover, importData.cover);
    assert.equal((await f.books.getAll()).length, 0); assert.equal((await f.db.getAll(STORE_NAMES.files)).length, 0);
    assert.equal(f.coverCalls(), 1); await f.coordinator.discard();
  });
  it("downloadedBookIsStoredLocally", async () => {
    const f = fixture(); await f.coordinator.prepare("drive", "book-1", () => undefined);
    const book = await f.coordinator.confirm(importData);
    assert.equal(book.offlineAvailability, "AVAILABLE"); assert.equal(await (await f.files.get(book.id))?.text(), pdf);
    assert.equal((await f.journal.pending()).length, 0);
  });
  it("downloadedBookWorksOffline", async () => {
    const f = fixture(); await f.coordinator.prepare("drive", "book-1", () => undefined);
    const book = await f.coordinator.confirm(importData); const before = f.calls.length;
    const restored = await new BookRepository(f.db).get(book.id);
    const restoredFile = await new LocalBookFileStore(new BookFileRepository(f.db)).get(book.id);
    assert.equal(restored?.offlineAvailability, "AVAILABLE"); assert.equal(await restoredFile?.text(), pdf); assert.equal(f.calls.length, before);
  });
  it("bookIsNeverUploadedToSupabaseStorage", async () => {
    const f = fixture(); await f.coordinator.prepare("drive", "book-1", () => undefined); await f.coordinator.confirm(importData);
    assert.equal(f.calls.length, 2); assert.match(f.calls[0]!, /^https:\/\/graph.microsoft.com/); assert.equal(f.calls[1], "download-direct");
  });
  it("duplicateIsDetected", async () => {
    const f = fixture(); await f.coordinator.prepare("drive", "book-1", () => undefined); await f.coordinator.confirm(importData);
    const preview = await f.coordinator.prepare("drive", "book-1", () => undefined);
    assert.equal(preview.duplicate.kind, "duplicate"); assert.equal(f.coverCalls(), 1);
    await assert.rejects(() => f.coordinator.confirm(importData), DuplicateBookImportError);
    await f.coordinator.discard(); assert.equal((await f.books.getAll()).length, 1);
  });
  it("cancelLeavesNoGhostBook", async () => {
    const f = fixture(); await f.coordinator.prepare("drive", "book-1", () => undefined); await f.coordinator.discard();
    assert.equal((await f.books.getAll()).length, 0); assert.equal((await f.db.getAll(STORE_NAMES.files)).length, 0); assert.equal((await f.journal.pending()).length, 0);
  });
  it("cancelDuringStreamStopsDownloadAndLeavesNoGhost", async () => {
    const client = graph(async () => Response.json(fileItem)); let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; }); let streamCancelled = false;
    const downloader = new OneDriveDownloadService(client, async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("%PDF")); started(); }, cancel() { streamCancelled = true; },
    })));
    const f = fixture(downloader); const pending = f.coordinator.prepare("drive", "book-1", () => undefined);
    await ready; f.coordinator.cancel(); await assert.rejects(() => pending, matches("import.download.cancelled"));
    assert.equal(streamCancelled, true); assert.equal((await f.books.getAll()).length, 0); assert.equal((await f.journal.pending()).length, 0);
  });
  it("quotaFailureRollsBackOnlyThisBook", async () => {
    const f = fixture(undefined, true); await f.coordinator.prepare("drive", "book-1", () => undefined);
    await assert.rejects(() => f.coordinator.confirm(importData), matches("import.processing.noSpace"));
    assert.equal((await f.books.getAll()).length, 0); assert.equal((await f.db.getAll(STORE_NAMES.files)).length, 0); assert.equal((await f.journal.pending()).length, 0);
  });
  it("cancelDuringLocalSaveRemovesThePartiallyWrittenFile", async () => {
    const f = fixture(); const controller = new AbortController();
    const manager = new ImportManager(new LocalFileImporter(), f.books, { save: async (id, blob) => { await f.files.save(id, blob); controller.abort(); },
      delete: id => f.files.delete(id), get: id => f.files.get(id) });
    const imported = await manager.select(new File([pdf], "book.pdf", { type: "application/pdf" }));
    await assert.rejects(() => manager.save({ ...imported, source: "onedrive" }, importData, undefined, { signal: controller.signal }), matches("import.download.cancelled"));
    assert.equal((await f.db.getAll(STORE_NAMES.files)).length, 0); assert.equal((await f.books.getAll()).length, 0);
  });
  it("interruptedStreamIsRejected", async () => {
    const downloader = new OneDriveDownloadService(graph(async () => Response.json(fileItem)), async () => new Response("%PDF"));
    await assert.rejects(() => downloader.download("drive", "id"), matches("import.download.interrupted"));
  });
  it("oversizedFilesRejectedBeforeDownloading", async () => {
    let downloaded = false;
    const downloader = new OneDriveDownloadService(graph(async () => Response.json({ ...fileItem, size: 300 * 1024 * 1024 })), async () => { downloaded = true; return new Response(pdf); });
    await assert.rejects(() => downloader.download("drive", "id"), matches("import.download.tooLarge")); assert.equal(downloaded, false);
  });
  it("sourceSettingsFailureDoesNotPretendToPersist", async () => {
    const storage: StorageAdapter = { load: async () => null, save: async () => { throw new Error("quota"); }, remove: async () => undefined };
    await assert.rejects(() => new OneDriveSourceRepository(storage, "user").save("Livro", link));
  });
});
