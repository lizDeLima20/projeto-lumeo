import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { zipSync } from "fflate";
import { extractFirstCbzPage } from "../src/reader/comic/CbzFirstPageExtractor";

/** A tiny, valid image payload - real magic bytes plus filler, exactly what
 *  sniffComicPageMime needs to recognize the format without a real decoder. */
const jpegBytes = (tag: string) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(`fake-jpeg-${tag}`)]);
const pngBytes = (tag: string) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new TextEncoder().encode(`fake-png-${tag}`)]);

/** Mimics an HTTP Range GET against an in-memory buffer, clamping like a real server does
 *  when the requested end runs past EOF - the same behaviour confirmed live against Drive. */
function fakeRangeFetcher(bytes: Uint8Array, calls: Array<[number, number]> = []) {
  return async (start: number, end: number): Promise<Uint8Array> => {
    calls.push([start, end]);
    return bytes.subarray(Math.max(0, start), Math.min(bytes.length, end + 1));
  };
}

describe("CBZ: a comic's first page via Range requests only, never the whole archive", () => {
  it("1. CBZ sem capa: a primeira imagem válida vira a thumbnail", async () => {
    const zip = zipSync({ "001.jpg": jpegBytes("one"), "002.jpg": jpegBytes("two") });
    const calls: Array<[number, number]> = [];
    const blob = await extractFirstCbzPage(zip.length, fakeRangeFetcher(zip, calls));
    assert.ok(blob, "deveria ter encontrado uma página");
    assert.equal(blob!.type, "image/jpeg");
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    assert.deepEqual(bytes, jpegBytes("one"));
  });

  it("nunca busca o arquivo inteiro - só a cauda, o diretório central e a primeira página", async () => {
    // Sized like a real comic archive (later pages padded with noise, so deflate cannot
    // shrink them away to nothing), so "much less than the whole file" is a meaningful
    // comparison rather than an artifact of a tiny, highly compressible fixture.
    const noise = (size: number) => new Uint8Array(randomBytes(size).buffer);
    const filler = (label: string, size: number) => new Uint8Array([...jpegBytes(label), ...noise(size)]);
    const zip = zipSync({ "001.jpg": jpegBytes("one"), "002.jpg": filler("two", 200_000), "003.jpg": filler("three", 200_000) });
    const calls: Array<[number, number]> = [];
    await extractFirstCbzPage(zip.length, fakeRangeFetcher(zip, calls));
    const totalBytesRequested = calls.reduce((sum, [start, end]) => sum + (end - start + 1), 0);
    assert.ok(totalBytesRequested < zip.length / 2,
      `pediu ${totalBytesRequested} de ${zip.length} bytes - deveria ser uma fração pequena do arquivo inteiro`);
    // Never a single request spanning the whole file.
    assert.ok(calls.every(([start, end]) => end - start + 1 < zip.length));
  });

  it("2. CBZ com PNG como primeira página também funciona", async () => {
    const zip = zipSync({ "a.png": pngBytes("only") });
    const blob = await extractFirstCbzPage(zip.length, fakeRangeFetcher(zip));
    assert.equal(blob!.type, "image/png");
  });

  it("3. metadata antes da primeira página real é ignorada (ComicInfo.xml, __MACOSX, ocultos)", async () => {
    const zip = zipSync({
      "ComicInfo.xml": new TextEncoder().encode("<ComicInfo></ComicInfo>"),
      "__MACOSX/._001.jpg": jpegBytes("resource-fork"),
      ".hidden.jpg": jpegBytes("hidden"),
      "Thumbs.db": new TextEncoder().encode("not an image"),
      "001.jpg": jpegBytes("real-first-page"),
    });
    const blob = await extractFirstCbzPage(zip.length, fakeRangeFetcher(zip));
    assert.ok(blob);
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    assert.deepEqual(bytes, jpegBytes("real-first-page"));
  });

  it("4. ordenação natural: 1, 2, 10 - nunca 1, 10, 2", async () => {
    // Lexicographic order would put "10.jpg" before "2.jpg" - natural order must not.
    const zip = zipSync({ "10.jpg": jpegBytes("ten"), "2.jpg": jpegBytes("two") });
    const blob = await extractFirstCbzPage(zip.length, fakeRangeFetcher(zip));
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    assert.deepEqual(bytes, jpegBytes("two"), "a página 2 deveria vir antes da página 10");
  });

  it("5. falha na extração devolve null - o placeholder do chamador permanece", async () => {
    const notAZip = new Uint8Array([1, 2, 3, 4, 5]);
    const blob = await extractFirstCbzPage(notAZip.length, fakeRangeFetcher(notAZip));
    assert.equal(blob, null);
  });

  it("um arquivo com só páginas não suportadas (nenhum jpg/png/webp) devolve null", async () => {
    const zip = zipSync({ "readme.txt": new TextEncoder().encode("oi") });
    const blob = await extractFirstCbzPage(zip.length, fakeRangeFetcher(zip));
    assert.equal(blob, null);
  });

  it("uma falha de rede no meio da extração também devolve null, nunca lança", async () => {
    const zip = zipSync({ "001.jpg": jpegBytes("one") });
    const flaky = async (): Promise<Uint8Array> => { throw new Error("rede indisponível"); };
    await assert.doesNotReject(async () => {
      const blob = await extractFirstCbzPage(zip.length, flaky);
      assert.equal(blob, null);
    });
  });

  it("arquivo vazio ou menor que um EOCD não trava, só devolve null", async () => {
    const blob = await extractFirstCbzPage(0, fakeRangeFetcher(new Uint8Array(0)));
    assert.equal(blob, null);
  });
});
