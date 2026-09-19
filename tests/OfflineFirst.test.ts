import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { Book } from "../src/models/Book";
import { IndexedDbService } from "../src/services/IndexedDbService";
import { SyncOutbox, SyncOutboxRepository } from "../src/services/SyncOutbox";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

const book = new Book({ id: "book-1", title: "Livro", author: "Autor", genreId: "g", cover: "cover", fileType: "pdf", fileName: "livro.pdf", fileSize: 10, mimeType: "application/pdf" });

describe("offline first", () => {
  it("mantém a alteração na fila até a reconexão", async () => {
    const database = new IndexedDbService(`offline-outbox-${crypto.randomUUID()}`), repository = new SyncOutboxRepository(database);
    let calls = 0;
    const account = { saveBook: async () => { calls++; }, deleteBook: async () => undefined, savePreferences: async () => undefined } as never;
    const outbox = new SyncOutbox(repository, account, "user-1");
    await outbox.enqueueBook(book, undefined, null);
    assert.equal(calls, 0);
    assert.equal((await repository.list("user-1")).length, 1);
    await outbox.flush();
    assert.equal(calls, 1);
    assert.equal((await repository.list("user-1")).length, 0);
  });

  it("mantém isolamento da fila entre usuários", async () => {
    const database = new IndexedDbService(`offline-isolation-${crypto.randomUUID()}`), repository = new SyncOutboxRepository(database);
    const account = { saveBook: async () => undefined, deleteBook: async () => undefined, savePreferences: async () => undefined } as never;
    await new SyncOutbox(repository, account, "user-a").enqueueBook(book, undefined, null);
    assert.equal((await repository.list("user-a")).length, 1);
    assert.equal((await repository.list("user-b")).length, 0);
  });
});