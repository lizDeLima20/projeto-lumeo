import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { ComicCoverCacheRepository } from "../src/repositories/ComicCoverCacheRepository";
import { IndexedDbService } from "../src/services/IndexedDbService";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

const database = () => new IndexedDbService(`lumeo-comic-covers-${crypto.randomUUID()}`);

describe("ComicCoverCacheRepository: capas geradas ficam só no dispositivo", () => {
  it("get/save: um hit devolve exatamente o que foi salvo", async () => {
    const repo = new ComicCoverCacheRepository(database());
    assert.equal(await repo.get("f1:2024"), null);
    await repo.save("f1:2024", "data:image/jpeg;base64,abc");
    assert.equal(await repo.get("f1:2024"), "data:image/jpeg;base64,abc");
  });

  it("chaves diferentes (fileId+modifiedAt) não colidem", async () => {
    const repo = new ComicCoverCacheRepository(database());
    await repo.save("f1:2024-01-01", "data:image/jpeg;base64,old");
    await repo.save("f1:2024-06-01", "data:image/jpeg;base64,new");
    assert.equal(await repo.get("f1:2024-01-01"), "data:image/jpeg;base64,old");
    assert.equal(await repo.get("f1:2024-06-01"), "data:image/jpeg;base64,new");
  });

  it("salvar de novo na mesma chave substitui, não duplica", async () => {
    const repo = new ComicCoverCacheRepository(database());
    await repo.save("f1:2024", "data:image/jpeg;base64,first");
    await repo.save("f1:2024", "data:image/jpeg;base64,second");
    assert.equal(await repo.get("f1:2024"), "data:image/jpeg;base64,second");
  });

  it("o cache não cresce sem limite: entradas antigas são removidas além do teto", async () => {
    const db = database();
    const repo = new ComicCoverCacheRepository(db);
    // MAX_ENTRIES is 500; saving comfortably past that must trim back down, keeping the
    // most recently saved entries.
    for (let i = 0; i < 520; i++) await repo.save(`f${i}:v`, `data:image/jpeg;base64,${i}`);
    const remaining = await db.getAll<{ key: string }>("comicCoverCache" as never);
    assert.ok(remaining.length <= 500, `esperava no máximo 500 entradas, tinha ${remaining.length}`);
    // The oldest ones (saved first) should be the ones evicted.
    assert.equal(await repo.get("f0:v"), null);
    assert.equal(await repo.get("f519:v"), "data:image/jpeg;base64,519");
  });
});
