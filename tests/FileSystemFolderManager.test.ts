import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { IndexedDbService } from "../src/services/IndexedDbService";
import { FileSystemFolderManager } from "../src/services/FileSystemFolderManager";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

describe("FileSystemFolderManager", () => {
  it("persists only pending catalogue metadata locally", async () => {
    const manager = new FileSystemFolderManager(new IndexedDbService(`catalog-folder-${crypto.randomUUID()}`));
    await manager.savePending({ bookId: "book-1", driveFileId: "drive-file-1", title: "Livro", author: "Autora", format: "epub",
      expectedFilename: "Livro.epub", coverUrl: null, catalogGenre: "Romance", sha256: null });
    assert.deepEqual(await manager.pending(), { bookId: "book-1", driveFileId: "drive-file-1", title: "Livro", author: "Autora", format: "epub",
      expectedFilename: "Livro.epub", coverUrl: null, catalogGenre: "Romance", sha256: null });
  });

  it("keeps a universal file-input fallback when File System Access is unavailable", () => {
    const manager = new FileSystemFolderManager(new IndexedDbService(`catalog-folder-${crypto.randomUUID()}`));
    assert.equal(manager.supportsDirectoryPicker, false);
    assert.equal(manager.supportsOpenFilePicker, false);
  });
});
