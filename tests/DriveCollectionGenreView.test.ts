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
    assert.match(view, /this\.coverLoader\.observe\(image, entry\)/);
    assert.match(view, /this\.onAdd\(entry, listing\)/);
    assert.match(view, /entry\.format === "pdf"/);
  });
});
