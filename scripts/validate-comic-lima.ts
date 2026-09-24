import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { ComicLimaDeserializer } from "../src/reader/comic/interaction/ComicLimaDeserializer";
import { ComicInteractionEngine } from "../src/reader/comic/interaction/ComicInteractionEngine";

const path = process.argv[2];
if (!path) throw new Error("Usage: npx tsx scripts/validate-comic-lima.ts path/to/comic.lima");
const bytes = new Uint8Array(readFileSync(path));
const archive = unzipSync(bytes);
const document = new ComicLimaDeserializer().deserialize(bytes);
const engine = new ComicInteractionEngine(); engine.open(document);
const pages = document.pages.map(page => {
  assert.ok(archive[page.imagePath]?.length, `Missing image: ${page.imagePath}`);
  for (const region of page.regions) {
    const hit = engine.hitTest(page.index, { x: region.x + region.width / 2, y: region.y + region.height / 2 });
    assert.equal(hit?.id, region.id, `Ambiguous hit: ${region.id}`);
    assert.equal(hit.text, region.text);
  }
  return { page: page.index + 1, cover: page.cover, regions: page.regions.length,
    review: page.regions.filter(region => region.recognitionStatus === "needs-review").length };
});
console.log(JSON.stringify({ path, bytes: bytes.length, entries: Object.keys(archive), pages, hitTests: "passed" }, null, 2));
