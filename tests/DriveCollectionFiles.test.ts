import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ComicCoverSource } from "../src/services/ComicCoverSource";
import type { DriveFolderEntry } from "../src/services/DriveCollectionService";

const source = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const file = (over: Partial<DriveFolderEntry> = {}): DriveFolderEntry => ({
  id: "f1", name: "Capítulo 01.pdf", kind: "file", mimeType: "application/pdf",
  format: "pdf", supported: true, contentType: "comic", size: 1024, modifiedAt: null, ...over,
});

describe("3/4. capa da HQ", () => {
  it("a miniatura do Drive é pedida no tamanho da tela, não a prévia de 220px", () => {
    const entry = { id: "f1", name: "Capítulo 01.pdf", kind: "file", supported: true, format: "pdf",
      thumbnailUrl: "https://lh3.googleusercontent.com/drive-storage/abc=s220" } as DriveFolderEntry;
    assert.equal(new ComicCoverSource(480, 680).coverUrl(entry), "https://lh3.googleusercontent.com/drive-storage/abc=s680");
    assert.equal(new ComicCoverSource().coverUrl(entry), "https://lh3.googleusercontent.com/drive-storage/abc=s452");
  });
  it("a capa é a primeira página do próprio PDF, sem download e sem upload", () => {
    const covers = new ComicCoverSource();
    const url = covers.coverUrl(file())!;
    assert.match(url, /^https:\/\/drive\.google\.com\/thumbnail\?id=f1&sz=w\d+-h\d+$/);
    // Nothing is written anywhere: it is a read-only link to the file already in Drive.
    const cover = source("src/services/ComicCoverSource.ts");
    assert.doesNotMatch(cover, /method:\s*"(POST|PUT|PATCH)"/);
    assert.doesNotMatch(cover, /files\/create|uploadType|multipart/i);
  });
  it("4. a capa resolvida fica em cache por fileId", () => {
    const covers = new ComicCoverSource();
    assert.equal(covers.isCached("f1"), false);
    const first = covers.coverUrl(file());
    assert.equal(covers.isCached("f1"), true);
    assert.equal(covers.coverUrl(file()), first);
    assert.equal(covers.size, 1);
  });
  it("os bytes da capa já são guardados pelo service worker", () => {
    const worker = source("public/sw.js");
    assert.match(worker, /drive\.google\.com" && url\.pathname === "\/thumbnail"/);
    assert.match(worker, /cacheFirst\(request, CATALOG_COVER_CACHE\)/);
  });
  it("só PDF suportado tem capa: CBR, pasta e desconhecido não", () => {
    const covers = new ComicCoverSource();
    assert.equal(covers.hasCover(file()), true);
    assert.equal(covers.hasCover(file({ format: "cbr", supported: false })), false);
    assert.equal(covers.hasCover(file({ format: "unknown", supported: false })), false);
    assert.equal(covers.hasCover(file({ kind: "folder", format: null })), false);
    assert.equal(covers.coverUrl(file({ format: "cbr", supported: false })), null);
  });
  it("as capas não são geradas todas ao abrir a pasta", () => {
    const view = source("src/views/CollectionBrowserView.ts");
    // The loader only fetches a cover once its row is near the viewport.
    assert.match(view, /this\.loader\?\.observe\(image, entry\)/);
    assert.match(source("src/services/ComicCoverSource.ts"), /IntersectionObserver/);
    assert.match(view, /image\.loading = "lazy"/);
  });
});

describe("5/6. formatos na tela", () => {
  it("CBR aparece marcado, nunca como PDF", () => {
    const view = source("src/views/CollectionBrowserView.ts");
    assert.match(view, /collection-entry--unsupported/);
    assert.match(view, /ui\.collections\.unsupported/);
    // The badge shows the real format, so a CBR reads as a CBR - and a file Lumeo could
    // not identify says so instead of showing the word "UNKNOWN" at the reader.
    assert.match(view, /entry\.format\.toUpperCase\(\)/);
    assert.match(view, /ui\.collections\.unknownFormat/);
  });
  it("nenhum item é escondido da lista", () => {
    const view = source("src/views/CollectionBrowserView.ts");
    assert.match(view, /listing\.entries\.forEach\(entry => this\.list!\.append/);
    assert.doesNotMatch(view, /entries\.filter\(.*supported/);
  });
  it("o cliente não decide tipo por extensão", () => {
    for (const path of ["src/services/DriveCollectionService.ts", "src/views/CollectionBrowserView.ts", "src/services/ComicCoverSource.ts"]) {
      assert.doesNotMatch(source(path), /endsWith\("\.pdf"\)|\/\\\.pdf\$\/|\.split\("\."\)/, path);
    }
  });
});

describe("10/11/12. nada mais foi tocado", () => {
  it("a navegação da Tarefa 1 continua no lugar", () => {
    const view = source("src/views/CollectionBrowserView.ts");
    assert.match(view, /collection-breadcrumb__step/);
    assert.match(view, /this\.onOpenFolder\(collectionId, entry\.id\)/);
    assert.match(source("src/services/DriveCollectionService.ts"), /private readonly folders = new Map/);
  });
  it("ComicReader, OCR e o leitor de livros seguem intactos", () => {
    assert.doesNotMatch(source("src/views/ComicReaderView.ts"), /DriveCollection|ComicCoverSource|collection/i);
    assert.match(source("src/reader/comic/TesseractComicOcrSource.ts"), /tessedit_pageseg_mode: "3"/);
    assert.doesNotMatch(source("src/views/ReaderView.ts"), /DriveCollection|ComicCoverSource/);
    assert.equal(source("src/models/Book.ts").includes('export type BookFileType = "pdf" | "epub";'), true);
  });
});
