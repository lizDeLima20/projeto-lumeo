import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("HQs publicadas como gênero do catálogo", () => {
  it("transforma pastas em seções e nunca em uma lista vertical de arquivos", () => {
    const view = source("src/views/DriveCollectionGenreView.ts");
    assert.match(view, /class DriveCollectionGenreView/);
    assert.match(view, /appendFolderSection/);
    assert.match(view, /drive-collection-section/);
    assert.match(view, /drive-comic-carousel__track/);
    assert.doesNotMatch(view, /collection-entry__open/);
  });

  it("resolve subpastas progressivamente até os PDFs reais", () => {
    const view = source("src/views/DriveCollectionGenreView.ts");
    assert.match(view, /new IntersectionObserver/);
    assert.match(view, /this\.collections\.open\(this\.collectionId, folder\.id, path\)/);
    assert.match(view, /listing\.entries\.filter\(entry => entry\.kind === "file"\)/);
    assert.match(view, /listing\.entries\.filter\(entry => entry\.kind === "folder"\)/);
  });

  it("usa a primeira página do PDF como capa e conserva o fluxo de importação existente", () => {
    const view = source("src/views/DriveCollectionGenreView.ts");
    assert.match(view, /ComicCoverSource/);
    assert.match(view, /LazyCoverLoader/);
    assert.match(view, /this\.coverLoader\.observe\(image, entry, this\.collectionId, fallback/);
    assert.match(view, /this\.onAdd\(entry, listing\)/);
    assert.match(view, /entry\.format === "pdf"/);
  });

  it("a busca de HQ dentro da coleção usa o índice do servidor, nunca uma varredura de pastas no cliente", () => {
    const view = source("src/views/DriveCollectionGenreView.ts");
    assert.match(view, /this\.collections\.search\(query, this\.collectionId\)/);
    // The old client-side crawl this replaced must be gone, not just unused.
    assert.doesNotMatch(view, /const queue: DriveFolderListing\[\] = \[root\]/);
    assert.doesNotMatch(view, /while \(queue\.length\)/);
  });
});

describe("navegação de pasta em coleções com mais de uma raiz física (sourceRootFolderIds)", () => {
  it("o caminho da próxima pasta vem do collectionPath da própria entrada, nunca reconstruído do breadcrumb da pasta atual", () => {
    const view = source("src/views/DriveCollectionGenreView.ts");
    // Rebuilding as [...parentListing.breadcrumb.map(id), folder.id] is exactly the bug: the
    // breadcrumb's first step is always the collection's own display id, not the physical
    // root a folder actually came from when it is one of sourceRootFolderIds.
    assert.match(view, /const path = folder\.collectionPath \?\? \[\.\.\.parentListing\.breadcrumb\.map/);
  });
});

describe("abrir uma HQ (detalhes) em coleções com mais de uma raiz física", () => {
  it("App usa entry.collectionPath para montar folder/path da rota comic, não listing.breadcrumb", () => {
    const app = source("src/core/App.ts");
    const method = app.slice(app.indexOf("private openComicDetails"), app.indexOf("private collectionImporter"));
    assert.match(method, /entry\.collectionPath/);
    assert.doesNotMatch(method, /path: listing\.breadcrumb\.map\(step => step\.id\)\.join\(","\)/);
  });
});
