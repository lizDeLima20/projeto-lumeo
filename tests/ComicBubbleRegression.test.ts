import assert from "node:assert/strict";
import { test } from "node:test";
import type { Block, Line, Worker } from "tesseract.js";
import { readFileSync } from "node:fs";
import { comicBubbleTarget } from "../src/reader/comic/interaction/ComicBubbleLayout";
import { comicSealCutoutAlpha } from "../src/reader/comic/interaction/ComicCutoutIntegrity";
import { ComicRegionOcr } from "../src/reader/comic/interaction/ComicRegionOcr";
import type { ComicVisualContainer } from "../src/reader/comic/interaction/ComicContainerDetector";
import { ComicInteractionEngine } from "../src/reader/comic/interaction/ComicInteractionEngine";
import { ComicHitMap } from "../src/reader/comic/interaction/ComicHitMap";
import type { ComicDocument } from "../src/reader/comic/interaction/ComicInteractionTypes";

test("expansion preserves its original centre despite crowded neighbouring hotspots", () => {
  const source = { x: 120, y: 300, width: 80, height: 50 }, viewport = { width: 360, height: 740 };
  const natural = comicBubbleTarget({ source, viewport, compact: true, safeTop: 80 });
  const target = comicBubbleTarget({ source, viewport, compact: true, safeTop: 80,
    obstacles: [{ x: 90, y: 340, width: 180, height: 250 }, { x: 70, y: 230, width: 200, height: 70 }] });
  assert.ok(Math.abs(target.x - natural.x) <= 8);
  assert.ok(Math.abs(target.y - natural.y) <= 8);
  assert.ok(target.y >= 80);
});

test("only the minimum viewport clamp displaces a balloon near top controls", () => {
  const source = { x: 100, y: 65, width: 100, height: 50 };
  const target = comicBubbleTarget({ source, viewport: { width: 360, height: 740 }, compact: true, safeTop: 90 });
  assert.equal(target.y, 90);
  assert.equal(target.x + target.width / 2, source.x + source.width / 2);
});

test("final alpha fills lettering holes but not scenery or an independent neighbour", () => {
  const alpha = new Uint8Array(100), excluded = new Uint8Array(100);
  for (let y = 1; y < 9; y++) for (let x = 1; x < 9; x++) alpha[y * 10 + x] = 255;
  alpha[33] = alpha[34] = alpha[55] = 0; excluded[55] = 1;
  const result = comicSealCutoutAlpha(alpha, 10, 10, excluded);
  assert.equal(result.alpha[33], 255); assert.equal(result.alpha[34], 255);
  assert.equal(result.alpha[55], 0); assert.equal(result.alpha[0], 0);
  assert.equal(result.holesFilled, 2); assert.equal(alpha[33], 0);
});

test("original pixels are not clipped a second time by a simplified polygon", () => {
  const source = readFileSync(new URL("../src/reader/comic/interaction/ComicBubbleView.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /element\.style\.clipPath\s*=/);
});

const line = (text: string, x: number, y: number): Line => ({ text,
  bbox: { x0: x, y0: y, x1: x + 80, y1: y + 14 }, confidence: 95,
  words: [{ text, confidence: 95 }] } as Line);

test("a connected upper/lower speech container stays one group while middle balloon stays independent", async () => {
  const make = (bbox: ComicVisualContainer["bbox"], contour: ComicVisualContainer["contour"]): ComicVisualContainer => ({
    bbox, ink: bbox, contour, type: "speech", shape: "balloon", tail: "none", styleConfidence: .95,
    backgroundColor: "#ffffff", textColor: "#000000", inkShare: .15, blockShare: .3,
    runs: 60, glyphShare: .95, bands: 4, darkOnLight: true,
    typography: { family: "comic", weight: "normal", italic: false, align: "center", capHeight: .014, lines: 4 },
    stencil: { x: bbox.x0, y: bbox.y0, step: 1, width: bbox.x1-bbox.x0, height: bbox.y1-bbox.y0,
      data: new Uint8Array((bbox.x1-bbox.x0)*(bbox.y1-bbox.y0)).fill(1) },
  });
  const connected = make({x0:100,y0:100,x1:600,y1:400},
    [{x:100,y:100},{x:600,y:100},{x:600,y:150},{x:150,y:150},{x:150,y:350},{x:600,y:350},{x:600,y:400},{x:100,y:400}]);
  const small = make({x0:300,y0:210,x1:400,y1:245},
    [{x:300,y:210},{x:400,y:210},{x:400,y:245},{x:300,y:245}]);
  let calls = 0;
  const worker = { setParameters: async () => undefined, terminate: async () => undefined,
    recognize: async () => {
      if (calls++ === 0) return {data:{text:"",confidence:95,blocks:[{paragraphs:[
        {lines:[line("Primeira fala",170,110)]},{lines:[line("Segunda fala",170,365)]},
        {lines:[line("Sim!",305,217)]}]}] as Block[]}};
      return {data:{text:"Texto original legível",confidence:95,blocks:[]}};
    },
  } as unknown as Worker;
  const ocr = new ComicRegionOcr(async () => worker);
  try {
    const regions = await ocr.recognize("page",1000,1500,0,undefined,[connected,small],()=>"crop");
    assert.equal(regions.length,2);
    const group = regions.find(r=>r.bubbleGroup)!;
    assert.ok(group); assert.equal(group.bubbleGroup!.members.length,2);
    // The small balloon lies inside the group's bounding BOX, not its actual silhouette.
    const engine = new ComicInteractionEngine();
    engine.open({pages:[{index:0,id:"p1",imagePath:"p.png",mimeType:"image/png",cover:false,regions}],
      manifest:{},metadata:{}} as ComicDocument);
    const map = new ComicHitMap([{pageIndex:0,rect:{x:0,y:0,width:1000,height:1500}}],engine);
    assert.equal(map.hit({x:200,y:125})?.region.id,group.id);
    assert.equal(map.hit({x:200,y:375})?.region.id,group.id);
    assert.notEqual(map.hit({x:350,y:230})?.region.id,group.id);
  } finally { await ocr.dispose(); }
});
