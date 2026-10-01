import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { Book3DFactory } from "../src/components/Book3DFactory";
import { Book } from "../src/models/Book";
import { ComicCoverCacheRepository } from "../src/repositories/ComicCoverCacheRepository";
import { ComicPresentationService, EMPTY_COMIC_METADATA } from "../src/services/ComicPresentationService";
import { IndexedDbService } from "../src/services/IndexedDbService";
import type { DriveFolderEntry, DriveFolderListing } from "../src/services/DriveCollectionService";

Object.assign(globalThis, { indexedDB, IDBKeyRange });
const source = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const entry = (id = "file-a", name = "001.cbr", modifiedAt = "v1"): DriveFolderEntry => ({
  id, name, modifiedAt, kind: "file", mimeType: "application/x-rar", format: "cbr",
  supported: true, contentType: "comic", size: 10, parentId: "series",
  collectionPath: ["root", "series", id],
});
const listing = (series = "[1963] - Os Vingadores"): Pick<DriveFolderListing, "breadcrumb"> => ({
  breadcrumb: [{ id: "root", name: "HQs da Marvel" }, { id: "series", name: series }],
});

describe("identidade visual e editorial das HQs", () => {
  it("ComicInfo tem precedência para Title/Series/Number/Year/Writer/Summary", () => {
    const value = new ComicPresentationService().present(entry(), listing(), {
      ...EMPTY_COMIC_METADATA, title: "A chegada", series: "Os Vingadores", number: "1",
      year: "1963", writer: "Stan Lee", summary: "A equipe se reúne.",
    });
    assert.deepEqual(value, { title: "A chegada", author: "Stan Lee", series: "Os Vingadores", number: "1", year: 1963, summary: "A equipe se reúne." });
  });

  it("pasta + 001.cbr gera título humano e ano inequívoco, sem hardcode de coleção", () => {
    assert.deepEqual(new ComicPresentationService().present(entry(), listing()), {
      title: "Os Vingadores #1", author: "", series: "Os Vingadores", number: "1", year: 1963,
    });
    assert.equal(new ComicPresentationService().present(entry("x", "Edição Especial.cbz"), listing("Série Futura")).title,
      "Série Futura — Edição Especial");
    assert.deepEqual(new ComicPresentationService().present(entry(), listing("[1963 - (2005 - 2013)] - Os Vingadores")), {
      title: "Os Vingadores #1", author: "", series: "Os Vingadores", number: "1", year: 1963,
    });
  });

  it("sem metadata e sem contexto, filename permanece o fallback e nenhuma sinopse é inventada", () => {
    const value = new ComicPresentationService().present(entry("x", "Arquivo Único.cbz"), { breadcrumb: [{ id: "root", name: "HQs" }] });
    assert.equal(value.title, "Arquivo Único");
    assert.equal(value.summary, undefined);
  });

  it("cache usa fileId+versão: nomes iguais em pastas diferentes não compartilham capa nem metadata", async () => {
    const repository = new ComicCoverCacheRepository(new IndexedDbService(`comic-identity-${crypto.randomUUID()}`));
    await repository.save("file-a:v1", "data:image/jpeg;base64,A", { ...EMPTY_COMIC_METADATA, title: "A" });
    await repository.save("file-b:v1", "data:image/jpeg;base64,B", { ...EMPTY_COMIC_METADATA, title: "B" });
    assert.equal((await repository.getEntry("file-a:v1"))?.metadata?.title, "A");
    assert.equal((await repository.getEntry("file-b:v1"))?.dataUrl, "data:image/jpeg;base64,B");
    assert.equal(await repository.get("file-a:v2"), null);
  });

  it("detalhes consultam o gerador compartilhado, reaproveitam capa/metadata e os passam à importação", () => {
    const view = source("views/ComicDetailsView.ts");
    assert.match(view, /defaultComicCoverGenerator\(\)/);
    assert.match(view, /coverGenerator\.resolve\(this\.collectionId, entry/);
    assert.match(view, /cover: resolvedCover \?\? asset\?\.dataUrl/);
    assert.match(view, /comicMetadata: resolvedMetadata \?\? asset\?\.metadata/);
  });

  it("a biblioteca recebe a capa resolvida e a prateleira 3D usa exatamente Book.cover", () => {
    const cover = "data:image/jpeg;base64,REAL";
    const book = new Book({ id: "hq", title: "HQ", author: "", genreId: "hqs", cover, fileType: "cbz",
      fileName: "001.cbz", fileSize: 10, mimeType: "application/zip", readingStatus: "unread", contentType: "comic" });
    assert.equal(new Book3DFactory().model(book, "FRONT").cover, cover);
    const importer = source("services/CollectionImportService.ts");
    assert.match(importer, /const cover = request\.cover \?\?/);
    assert.match(importer, /summary: presentation\.summary/);
  });

  it("livros normais continuam usando o mesmo Book.cover no 3D", () => {
    const book = new Book({ id: "book", title: "Livro", author: "Autor", genreId: "g", cover: "normal-cover", fileType: "pdf",
      fileName: "livro.pdf", fileSize: 10, mimeType: "application/pdf", readingStatus: "unread" });
    assert.equal(new Book3DFactory().model(book, "FRONT").cover, "normal-cover");
    assert.equal(book.contentType, "book");
  });
});
