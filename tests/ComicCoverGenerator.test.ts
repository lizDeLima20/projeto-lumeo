import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComicCoverGenerator } from "../src/services/ComicCoverGenerator";
import type { DriveFolderEntry } from "../src/services/DriveCollectionService";

const jpegBytes = (tag: string) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(`fake-jpeg-${tag}`)]);

/** CoverService.fromBlob() depends on FileReader/createImageBitmap, browser-only APIs
 *  this suite has no polyfill for (nothing in the codebase testing it directly does
 *  either - see CollectionImport.test.ts's own fake CoverService). This stand-in keeps the
 *  same "Blob in, data URL out" contract so ComicCoverGenerator's own wiring can still be
 *  proven, without needing a real browser to run in. */
function fakeCovers() {
  return { fromBlob: async (blob: Blob) => `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}` };
}

function fakeCache() {
  const store = new Map<string, string | { dataUrl: string; metadata?: import("../src/services/ComicPresentationService").ComicMetadata }>();
  const calls: string[] = [];
  return {
    get: async (key: string) => { calls.push("get:" + key); const value = store.get(key); return typeof value === "string" ? value : value?.dataUrl ?? null; },
    getEntry: async (key: string) => {
      calls.push("get:" + key); const value = store.get(key);
      return typeof value === "string" ? { key, dataUrl: value, updatedAt: "now" } : value ? { key, ...value, updatedAt: "now" } : null;
    },
    save: async (key: string, dataUrl: string, metadata?: import("../src/services/ComicPresentationService").ComicMetadata) => {
      calls.push("save:" + key); store.set(key, metadata ? { dataUrl, metadata } : dataUrl);
    },
    store, calls,
  };
}

/** A stand-in for ApiClient.getRaw() - the BFF's own comic-cover endpoint. Counts every
 *  call, so a test can prove a cache hit or a dedup never reaches it again, and records the
 *  requested path so tests can check the collectionId/fileId/path trail sent. */
function fakeApi(response: (path: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  return {
    getRaw: async (path: string, _authenticated?: boolean) => { calls.push(path); return response(path); },
    calls,
  };
}

const comic = (over: Partial<DriveFolderEntry> = {}): DriveFolderEntry => ({
  id: "f1", name: "001.cbz", kind: "file", mimeType: "application/zip",
  format: "cbz", supported: true, contentType: "comic", size: 1024, modifiedAt: "2024-01-01",
  parentId: "root", collectionPath: ["root", "f1"], ...over,
});

describe("ComicCoverGenerator: capa sob demanda para CBR/CBZ, via o endpoint do BFF", () => {
  it("2. CBR/CBZ sem capa: o BFF devolve a imagem já pronta, sem o cliente baixar ou abrir o archive", async () => {
    const cache = fakeCache();
    const api = fakeApi(() => new Response(jpegBytes("cover"), { status: 200, headers: { "Content-Type": "image/jpeg" } }));
    const generator = new ComicCoverGenerator(cache as never, api as never, fakeCovers() as never);
    const entry = comic({ id: "cbr-1", format: "cbr", name: "001.cbr", collectionPath: ["root", "cbr-1"] });
    const result = await generator.cover("marvel-hqs", entry);
    assert.ok(result, "deveria ter gerado uma capa");
    assert.match(result!, /^data:image\//);
    assert.equal(api.calls.length, 1);
    assert.match(api.calls[0]!, /^\/collections\/marvel-hqs\/comic-cover\/cbr-1\?path=root%2Ccbr-1$/,
      "envia só collectionId + fileId + o mesmo path trail já validado, nunca uma URL do Drive");
  });

  it("uma resposta de erro do BFF (404/503/etc.) devolve null, nunca lança - o placeholder permanece", async () => {
    const cache = fakeCache();
    const api = fakeApi(() => new Response(null, { status: 404 }));
    const generator = new ComicCoverGenerator(cache as never, api as never, fakeCovers() as never);
    const result = await generator.cover("marvel-hqs", comic({ id: "cbr-2", format: "cbr" }));
    assert.equal(result, null);
  });

  it("uma falha de rede também devolve null, nunca lança", async () => {
    const cache = fakeCache();
    const api = { getRaw: async () => { throw new Error("rede indisponível"); }, calls: [] };
    const generator = new ComicCoverGenerator(cache as never, api as never, fakeCovers() as never);
    await assert.doesNotReject(async () => {
      const result = await generator.cover("marvel-hqs", comic());
      assert.equal(result, null);
    });
  });

  it("uma HQ sem collectionPath conhecido nunca chega a chamar o BFF", async () => {
    const cache = fakeCache();
    const api = fakeApi(() => new Response(jpegBytes("x"), { status: 200 }));
    const generator = new ComicCoverGenerator(cache as never, api as never, fakeCovers() as never);
    const result = await generator.cover("marvel-hqs", comic({ collectionPath: undefined }));
    assert.equal(result, null);
    assert.deepEqual(api.calls, []);
  });

  it("6. cache hit: não chama o BFF de novo", async () => {
    const cache = fakeCache();
    cache.store.set("cached-1:2024-01-01", "data:image/jpeg;base64,already-cached");
    const api = fakeApi(() => new Response(jpegBytes("x"), { status: 200 }));
    const generator = new ComicCoverGenerator(cache as never, api as never, fakeCovers() as never);
    const result = await generator.cover("marvel-hqs", comic({ id: "cached-1" }));
    assert.equal(result, "data:image/jpeg;base64,already-cached");
    assert.deepEqual(api.calls, [], "um hit de cache não deveria tocar a rede");
  });

  it("7. duas solicitações simultâneas da mesma HQ: só uma chamada ao BFF", async () => {
    const cache = fakeCache();
    const api = fakeApi(() => new Response(jpegBytes("shared"), { status: 200 }));
    const generator = new ComicCoverGenerator(cache as never, api as never, fakeCovers() as never);
    const entry = comic({ id: "dup-1" });
    const [first, second] = await Promise.all([generator.cover("marvel-hqs", entry), generator.cover("marvel-hqs", entry)]);
    assert.ok(first && second);
    assert.equal(first, second);
    assert.equal(api.calls.length, 1, "duas chamadas simultâneas devem compartilhar a mesma requisição ao BFF");
    assert.equal(cache.calls.filter(call => call.startsWith("save:")).length, 1, "só deveria salvar uma vez no cache");
  });

  it("8. limite de concorrência: nunca mais do que o configurado roda ao mesmo tempo", async () => {
    const cache = fakeCache();
    let active = 0, peak = 0;
    const api = fakeApi(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return new Response(jpegBytes("x"), { status: 200 });
    });
    const generator = new ComicCoverGenerator(cache as never, api as never, fakeCovers() as never, 2);
    const entries = Array.from({ length: 6 }, (_, i) => comic({ id: `q-${i}`, modifiedAt: `v${i}`, collectionPath: ["root", `q-${i}`] }));
    await Promise.all(entries.map(entry => generator.cover("marvel-hqs", entry)));
    assert.ok(peak <= 2, `pico de concorrência foi ${peak}, deveria ser no máximo 2`);
  });

  it("9. abandona um pedido enfileirado se o card já saiu de tela antes de começar", async () => {
    const cache = fakeCache();
    const api = fakeApi(async () => { await new Promise(resolve => setTimeout(resolve, 5)); return new Response(jpegBytes("x"), { status: 200 }); });
    // concurrency=1: the first request occupies the only slot, so the second one waits in
    // the queue and can observe shouldContinue() before it ever starts.
    const generator = new ComicCoverGenerator(cache as never, api as never, fakeCovers() as never, 1);
    const busy = generator.cover("marvel-hqs", comic({ id: "busy", modifiedAt: "a" }));
    let stillVisible = true;
    const abandoned = generator.cover("marvel-hqs", comic({ id: "abandoned", modifiedAt: "b", collectionPath: ["root", "abandoned"] }), () => stillVisible);
    stillVisible = false;
    const [busyResult, abandonedResult] = await Promise.all([busy, abandoned]);
    assert.ok(busyResult, "o primeiro pedido, já em andamento, deveria terminar normalmente");
    assert.equal(abandonedResult, null, "o segundo, abandonado antes de começar, não deveria gerar nada");
    // Only the first entry's id should ever have reached the BFF.
    assert.ok(api.calls.every(call => call.includes("/busy?")));
  });

  it("uma HQ sem CBR/CBZ (PDF, ou pasta) nunca é processada por este gerador", async () => {
    const cache = fakeCache();
    const api = fakeApi(() => new Response(jpegBytes("x"), { status: 200 }));
    const generator = new ComicCoverGenerator(cache as never, api as never, fakeCovers() as never);
    const result = await generator.cover("marvel-hqs", comic({ format: "pdf" }));
    assert.equal(result, null);
    assert.deepEqual(api.calls, []);
    assert.deepEqual(cache.calls, [], "nem o cache é consultado para um formato fora de escopo");
  });
});
