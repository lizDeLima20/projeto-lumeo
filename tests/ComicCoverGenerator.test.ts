import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zipSync } from "fflate";
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
  const store = new Map<string, string>();
  const calls: string[] = [];
  return {
    get: async (key: string) => { calls.push(`get:${key}`); return store.get(key) ?? null; },
    save: async (key: string, dataUrl: string) => { calls.push(`save:${key}`); store.set(key, dataUrl); },
    store, calls,
  };
}

/** A network stand-in that answers Range requests against an in-memory ZIP, and counts
 *  every call - so a test can prove a cache hit or a dedup never touches it again. */
function fakeFetch(zip: Uint8Array, options: { delayMs?: number } = {}) {
  const calls: string[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push(String(url));
    if (options.delayMs) await new Promise(resolve => setTimeout(resolve, options.delayMs));
    const rangeHeader = (init?.headers as Record<string, string> | undefined)?.Range;
    if (!rangeHeader) return new Response(new Uint8Array(zip), { status: 200 });
    const [start, end] = rangeHeader.replace("bytes=", "").split("-").map(Number);
    const body = zip.subarray(Math.max(0, start!), Math.min(zip.length, end! + 1));
    return new Response(body, { status: 206 });
  }) as typeof fetch;
  return { impl, calls };
}

const comic = (over: Partial<DriveFolderEntry> = {}): DriveFolderEntry => ({
  id: "f1", name: "001.cbz", kind: "file", mimeType: "application/zip",
  format: "cbz", supported: true, contentType: "comic", size: 0, modifiedAt: "2024-01-01", ...over,
});

describe("ComicCoverGenerator: capa sob demanda para CBR/CBZ", () => {
  it("2. CBR sem capa: a primeira imagem válida vira a thumbnail, reutilizando o engine existente", async () => {
    const cache = fakeCache();
    const opened: string[] = [];
    const fakeArchive = {
      open: async () => { opened.push("open"); return 1; },
      image: async (page: number) => { opened.push(`image:${page}`); return new Blob([jpegBytes("cbr-page-1")], { type: "image/jpeg" }); },
      close: async () => { opened.push("close"); },
    };
    // body irrelevant - the archive engine itself is faked below.
    const { impl: fetchImpl, calls } = fakeFetch(new Uint8Array([1, 2, 3]));
    const generator = new ComicCoverGenerator(cache as never, fakeCovers() as never, fetchImpl, 3, () => fakeArchive);
    const entry = comic({ id: "cbr-1", format: "cbr", name: "001.cbr" });
    const result = await generator.cover(entry);
    assert.ok(result, "deveria ter gerado uma capa");
    assert.match(result!, /^data:image\//);
    assert.deepEqual(opened, ["open", "image:1", "close"], "reutiliza open/image(1)/close do engine existente, nesta ordem");
    assert.ok(calls[0]?.includes(encodeURIComponent("cbr-1")), "baixa pelo mesmo link público de sempre");
  });

  it("CBR: falha ao abrir o archive devolve null, nunca lança - o placeholder permanece", async () => {
    const cache = fakeCache();
    const fakeArchive = {
      open: async () => { throw new Error("HQ corrompida"); },
      image: async () => { throw new Error("não deveria chegar aqui"); },
      close: async () => undefined,
    };
    const { impl: fetchImpl } = fakeFetch(new Uint8Array([1]));
    const generator = new ComicCoverGenerator(cache as never, fakeCovers() as never, fetchImpl, 3, () => fakeArchive);
    const result = await generator.cover(comic({ id: "cbr-2", format: "cbr" }));
    assert.equal(result, null);
  });

  it("6. cache hit: não baixa nem processa de novo", async () => {
    const cache = fakeCache();
    cache.store.set("cached-1:2024-01-01", "data:image/jpeg;base64,already-cached");
    const { impl: fetchImpl, calls } = fakeFetch(zipSync({ "1.jpg": jpegBytes("x") }));
    const generator = new ComicCoverGenerator(cache as never, fakeCovers() as never, fetchImpl);
    const result = await generator.cover(comic({ id: "cached-1", size: 999 }));
    assert.equal(result, "data:image/jpeg;base64,already-cached");
    assert.deepEqual(calls, [], "um hit de cache não deveria tocar a rede");
  });

  it("7. duas solicitações simultâneas da mesma HQ: só um processamento", async () => {
    const cache = fakeCache();
    const zip = zipSync({ "1.jpg": jpegBytes("shared") });
    const { impl: fetchImpl, calls } = fakeFetch(zip);
    const generator = new ComicCoverGenerator(cache as never, fakeCovers() as never, fetchImpl);
    const entry = comic({ id: "dup-1", size: zip.length });
    const [first, second] = await Promise.all([generator.cover(entry), generator.cover(entry)]);
    assert.ok(first && second);
    assert.equal(first, second);
    assert.equal(cache.calls.filter(call => call.startsWith("save:")).length, 1, "só deveria salvar uma vez no cache");
  });

  it("8. limite de concorrência: nunca mais do que o configurado roda ao mesmo tempo", async () => {
    const cache = fakeCache();
    const zip = zipSync({ "1.jpg": jpegBytes("x") });
    let active = 0, peak = 0;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      const rangeHeader = (init?.headers as Record<string, string> | undefined)?.Range;
      if (!rangeHeader) return new Response(new Uint8Array(zip), { status: 200 });
      const [start, end] = rangeHeader.replace("bytes=", "").split("-").map(Number);
      return new Response(zip.subarray(Math.max(0, start!), Math.min(zip.length, end! + 1)), { status: 206 });
    }) as typeof fetch;
    const generator = new ComicCoverGenerator(cache as never, fakeCovers() as never, fetchImpl, 2);
    const entries = Array.from({ length: 6 }, (_, i) => comic({ id: `q-${i}`, size: zip.length, modifiedAt: `v${i}` }));
    await Promise.all(entries.map(entry => generator.cover(entry)));
    assert.ok(peak <= 2, `pico de concorrência foi ${peak}, deveria ser no máximo 2`);
  });

  it("9. abandona um pedido enfileirado se o card já saiu de tela antes de começar", async () => {
    const cache = fakeCache();
    const zip = zipSync({ "1.jpg": jpegBytes("x") });
    const { impl: fetchImpl, calls } = fakeFetch(zip, { delayMs: 5 });
    // concurrency=1: the first request occupies the only slot, so the second one waits in
    // the queue and can observe shouldContinue() before it ever starts.
    const generator = new ComicCoverGenerator(cache as never, fakeCovers() as never, fetchImpl, 1);
    const busy = generator.cover(comic({ id: "busy", size: zip.length, modifiedAt: "a" }));
    let stillVisible = true;
    const abandoned = generator.cover(comic({ id: "abandoned", size: zip.length, modifiedAt: "b" }), () => stillVisible);
    stillVisible = false;
    const [busyResult, abandonedResult] = await Promise.all([busy, abandoned]);
    assert.ok(busyResult, "o primeiro pedido, já em andamento, deveria terminar normalmente");
    assert.equal(abandonedResult, null, "o segundo, abandonado antes de começar, não deveria gerar nada");
    // Only the first entry's id should ever have reached the network.
    assert.ok(calls.every(call => call.includes(encodeURIComponent("busy")) || !call.includes("id=")));
  });

  it("uma HQ sem CBR/CBZ (PDF, ou pasta) nunca é processada por este gerador", async () => {
    const cache = fakeCache();
    const { impl: fetchImpl, calls } = fakeFetch(new Uint8Array([1]));
    const generator = new ComicCoverGenerator(cache as never, fakeCovers() as never, fetchImpl);
    const result = await generator.cover(comic({ format: "pdf" }));
    assert.equal(result, null);
    assert.deepEqual(calls, []);
    assert.deepEqual(cache.calls, [], "nem o cache é consultado para um formato fora de escopo");
  });
});
