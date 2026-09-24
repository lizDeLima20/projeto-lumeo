import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unzipSync, strFromU8 } from "fflate";
import {
  ComicConverter,
  ComicInteractionEngine,
  ComicInteractionValidator,
  ComicLimaDeserializer,
  ComicLimaSerializer,
  type ComicDocument,
  type ComicTextRegion,
} from "../src/reader/comic/interaction";

function region(overrides: Partial<ComicTextRegion> = {}): ComicTextRegion {
  return {
    id: "r-1",
    pageIndex: 1,
    text: "Ola mundo",
    x: 0.72,
    y: 0.31,
    width: 0.18,
    height: 0.09,
    shape: "balloon",
    tailDirection: "down-left",
    type: "speech",
    ocrConfidence: 0.93,
    ...overrides,
  };
}

function document(): ComicDocument {
  const createdAt = "2026-09-22T00:00:00.000Z";
  return {
    manifest: {
      format: "lima",
      version: 1,
      contentType: "comic",
      documentId: "comic-1",
      createdAt,
      generator: "test",
      metadataPath: "metadata/metadata.json",
      pagesPath: "pages/",
      interactionPath: "interaction/",
      pages: [
        { index: 0, id: "page-001", imagePath: "pages/001.webp", interactionPath: "interaction/001.json", mimeType: "image/webp", width: 1200, height: 1800, cover: true },
        { index: 1, id: "page-002", imagePath: "pages/002.webp", interactionPath: "interaction/002.json", mimeType: "image/webp", width: 1200, height: 1800 },
        { index: 2, id: "page-003", imagePath: "pages/003.webp", mimeType: "image/webp", width: 1200, height: 1800 },
      ],
    },
    metadata: {
      id: "comic-1",
      title: "HQ Teste",
      author: "Lumeo",
      language: "pt-BR",
      sourceFileName: "hq.pdf",
      sourceFormat: "pdf",
      createdAt,
    },
    pages: [
      { index: 0, id: "page-001", imagePath: "pages/001.webp", width: 1200, height: 1800, mimeType: "image/webp", cover: true, regions: [] },
      { index: 1, id: "page-002", imagePath: "pages/002.webp", width: 1200, height: 1800, mimeType: "image/webp", cover: false, regions: [region()] },
      { index: 2, id: "page-003", imagePath: "pages/003.webp", width: 1200, height: 1800, mimeType: "image/webp", cover: false, regions: [] },
    ],
  };
}

describe("ComicInteraction .lima foundation", () => {
  it("serializes and deserializes the comic manifest", () => {
    const bytes = new ComicLimaSerializer().serialize(document());
    const archive = unzipSync(bytes);
    const manifest = JSON.parse(strFromU8(archive["manifest.json"]!)) as ComicDocument["manifest"];
    assert.equal(manifest.format, "lima");
    assert.equal(manifest.version, 1);
    assert.equal(manifest.contentType, "comic");
    assert.equal(manifest.pages[0]?.imagePath, "pages/001.webp");
    assert.equal(new ComicLimaDeserializer().deserialize(bytes).metadata.title, "HQ Teste");
  });

  it("models ComicDocument, ComicPage and ComicTextRegion with normalized coordinates", () => {
    const value = document();
    assert.equal(new ComicInteractionValidator().validateDocument(value), true);
    const textRegion = value.pages[1]!.regions[0]!;
    assert.deepEqual([textRegion.x, textRegion.y, textRegion.width, textRegion.height], [0.72, 0.31, 0.18, 0.09]);
    assert.equal(textRegion.type, "speech");
    assert.equal(textRegion.tailDirection, "down-left");
  });

  it("rejects non-normalized regions", () => {
    assert.throws(() => new ComicInteractionValidator().validateRegion(region({ x: 0.9, width: 0.2 })), /ultrapassa/);
    assert.throws(() => new ComicInteractionValidator().validateRegion(region({ ocrConfidence: 93 })), /normalizada/);
  });

  it("reads every LIMA version it knows and refuses the ones it does not", () => {
    // 2 added the container and touch rectangles, 3 the container as a shape. A package
    // written by any of them still opens; one from a future format does not.
    for (const version of [1, 2, 3, 4]) {
      const value = document();
      (value.manifest as { version: number }).version = version;
      assert.ok(new ComicInteractionValidator().validateDocument(value), `versão ${version}`);
    }
    const future = document();
    (future.manifest as { version: number }).version = 5;
    assert.throws(() => new ComicInteractionValidator().validateDocument(future), /Versão/);
  });

  it("supports pages without regions and pages marked as cover", () => {
    const restored = new ComicLimaDeserializer().deserialize(new ComicLimaSerializer().serialize(document()));
    assert.equal(restored.pages[0]?.cover, true);
    assert.deepEqual(restored.pages[0]?.regions, []);
    assert.deepEqual(restored.pages[2]?.regions, []);
  });

  it("loads a .lima page even when interaction data is absent", () => {
    const restored = new ComicLimaDeserializer().deserialize(new ComicLimaSerializer().serialize(document()));
    assert.equal(restored.pages[2]?.imagePath, "pages/003.webp");
    assert.deepEqual(restored.pages[2]?.regions, []);
  });

  it("offers a page-turn independent engine for current and future readers", () => {
    const engine = new ComicInteractionEngine();
    engine.open(document());
    assert.equal(engine.hasInteractionData, true);
    assert.equal(engine.regionsForPage(0).length, 0);
    assert.equal(engine.hitTest(1, { x: 0.75, y: 0.35 })?.id, "r-1");
    assert.equal(engine.hitTest(1, { x: 0.1, y: 0.1 }), null);
  });

  it("runs the converter pipeline with Android/Web compatible package paths", async () => {
    const stages: string[] = [];
    const savedPages: number[] = [];
    const result = await new ComicConverter().convert({
      id: "comic-2",
      title: "Pipeline",
      totalPages: 2,
      sourceFileName: "pipeline.pdf",
      sourceFormat: "pdf",
      pageProvider: async pageIndex => ({
        path: `pages/${String(pageIndex + 1).padStart(3, "0")}.webp`,
        data: new Uint8Array([pageIndex]),
        mimeType: "image/webp",
        width: 800,
        height: 1200,
      }),
    }, {
      onProgress: progress => stages.push(progress.stage),
      onPageProcessed: page => savedPages.push(page.index),
    });
    assert.deepEqual(savedPages, [0, 1]);
    assert.deepEqual(stages, ["PREPARING", "PROCESSING_PAGE", "PROCESSING_PAGE", "SAVING", "COMPLETED"]);
    assert.equal(result.document.manifest.pages[0]?.imagePath, "pages/001.webp");
    assert.equal(new ComicLimaDeserializer().deserialize(result.bytes).pages.length, 2);
  });
});
