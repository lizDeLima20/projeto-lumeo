import assert from "node:assert/strict";
import { test } from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { strToU8, unzipSync, zipSync } from "fflate";
import type { Block, Line, Worker } from "tesseract.js";
import { ComicConverter } from "../src/reader/comic/interaction/ComicConverter";
import { IndexedDbComicConversionCache } from "../src/reader/comic/interaction/ComicConversionCache";
import { ComicLimaDeserializer } from "../src/reader/comic/interaction/ComicLimaDeserializer";
import { ComicInteractionEngine } from "../src/reader/comic/interaction/ComicInteractionEngine";
import { ComicRegionOcr, comicTextCandidates, groupComicTextLines } from "../src/reader/comic/interaction/ComicRegionOcr";
import { ComicLayout } from "../src/reader/comic/ComicLayout";
import { drawComicInteractionDebug } from "../src/reader/comic/interaction/ComicInteractionDebug";
import type { ComicTextRegion } from "../src/reader/comic/interaction/ComicInteractionTypes";
import { detectComicContainers, type ComicVisualContainer } from "../src/reader/comic/interaction/ComicContainerDetector";
import { comicCropPlans, comicCropPolarity, comicInkThreshold, comicPrepareCrop } from "../src/reader/comic/interaction/ComicRegionCrop";
import { comicRegionBounds } from "../src/reader/comic/interaction/ComicRegionBounds";
import { maskArea, maskBounds, readMaskShape, simplifyContour, splitByTextBlocks, splitTouchingMasks, traceMaskContour, type ComicMask } from "../src/reader/comic/interaction/ComicShapeMask";
import { comicSourceKey } from "../src/reader/comic/interaction/ComicConversionIdentity";

Object.assign(globalThis, { indexedDB, IDBKeyRange });
const asset = async (index: number) => ({ path: `pages/${String(index + 1).padStart(3, "0")}.png`, data: new Uint8Array([1, 2, 3]), mimeType: "image/png" as const, width: 100, height: 150 });
const region = (pageIndex: number): ComicTextRegion => ({ id: `r${pageIndex}`, pageIndex, text: "Texto original?", x: .1, y: .2, width: .3, height: .1,
  type: "other", shape: "unknown", tailDirection: "none", ocrConfidence: .4, recognitionStatus: "needs-review" });
const line = (text: string, x: number, y: number): Line => ({ text, bbox: { x0: x, x1: x + 60, y0: y, y1: y + 10 }, confidence: 95, words: [{ text, confidence: 95 }] } as Line);
const blocks = (paragraphs: Line[][]): Block[] => [{ paragraphs: paragraphs.map(lines => ({ lines })) } as Block];

test("three lines stay together, neighboring paragraphs and large vertical gaps stay separate", () => {
  const result = comicTextCandidates(blocks([[line("A", 10, 10), line("B", 10, 24), line("C", 10, 38)], [line("D", 75, 10)], [line("E", 10, 100), line("F", 10, 150)]]));
  assert.equal(result.length, 4); assert.deepEqual(result[0]!.lines.map(value => value.text), ["A", "B", "C"]);
});

test("sparse lines form one region per column and never bridge nearby speakers", () => {
  const candidates = comicTextCandidates(blocks([[line("First", 10, 10)], [line("second", 10, 24)], [line("third", 10, 38)],
    [line("Neighbor", 90, 10)], [line("next", 90, 24)], [line("Other speaker", 10, 70)]]));
  const groups = groupComicTextLines(candidates);
  assert.equal(groups.length, 3); assert.equal(groups[0]?.lines.length, 3); assert.equal(groups[1]?.lines.length, 2);
});

test("region OCR preserves uncertain raw spelling and accents, then supports exact hit tests", async () => {
  let calls = 0; let terminated = false;
  const ocr = new ComicRegionOcr(async () => ({
    setParameters: async () => undefined,
    recognize: async (_image: unknown, options: { rectangle?: unknown }) => {
      calls++;
      if (calls === 1) return { data: { blocks: blocks([[line("Olá", 10, 20), line("Mund0?", 10, 34)]]) } };
      assert.ok(options.rectangle);
      // Recognized as it stands, digit and all: nothing here corrects "Mund0?" to "Mundo?".
      return { data: { text: "Olá\nMund0?", confidence: 63, blocks: blocks([[{ ...line("Mund0?", 10, 34), words: [{ confidence: 30 }] } as Line]]) } };
    }, terminate: async () => { terminated = true; },
  } as unknown as Worker));
  const regions = await ocr.recognize("image", 100, 150, 1);
  assert.equal(regions[0]?.text, "Olá\nMund0?"); assert.equal(regions[0]?.recognitionStatus, "needs-review");
  assert.equal(regions[0]?.ocrConfidence, .63); assert.equal(calls, 2);
  const result = await new ComicConverter().convert({ id: "raw", title: "Raw", totalPages: 2, pageProvider: asset, regionProvider: async () => regions });
  const engine = new ComicInteractionEngine(); engine.open(new ComicLimaDeserializer().deserialize(result.bytes));
  const r = regions[0]!; assert.equal(engine.hitTest(1, { x: r.x + r.width / 2, y: r.y + r.height / 2 })?.text, r.text);
  await ocr.dispose(); assert.ok(terminated);
});

test("progressive cache resumes after cancellation and skips OCR for cover and completed conversions", async () => {
  const key = crypto.randomUUID(); const cache = new IndexedDbComicConversionCache(); const controller = new AbortController();
  let renders = 0; let ocrCalls = 0; let releases = 0;
  const input = { id: key, title: "Resume", totalPages: 3, conversionKey: key,
    pageProvider: async (index: number) => { renders++; return asset(index); },
    regionProvider: async (index: number) => { ocrCalls++; return [region(index)]; }, releasePage: () => { releases++; } };
  const stages: string[] = [];
  await assert.rejects(new ComicConverter().convert(input, { cache, signal: controller.signal, onProgress: p => stages.push(p.stage),
    onPageProcessed: page => { if (page.index === 1) controller.abort(); } }));
  assert.equal(stages.at(-1), "FAILED"); assert.ok(!stages.includes("COMPLETED")); assert.equal(await cache.completed(key), undefined);
  assert.ok(await cache.page(key, 1)); assert.equal(ocrCalls, 1); assert.equal(releases, 2);
  const result = await new ComicConverter().convert(input, { cache: new IndexedDbComicConversionCache() });
  assert.equal(renders, 3); assert.equal(ocrCalls, 2); assert.equal(result.document.pages[0]?.regions.length, 0);
  const entries = unzipSync(result.bytes); assert.equal(Object.keys(entries).length, 8);
  assert.equal(new ComicLimaDeserializer().deserialize(result.bytes).pages[2]?.regions[0]?.text, "Texto original?");
  await new ComicConverter().convert(input, { cache }); assert.equal(renders, 3); assert.equal(ocrCalls, 2);
});

test("aborting during OCR releases the active worker without waiting for recognition", async () => {
  const controller = new AbortController(); let terminated = false;
  const ocr = new ComicRegionOcr(async () => ({ setParameters: async () => undefined,
    recognize: async () => { controller.abort(); return new Promise(() => {}); },
    terminate: async () => { terminated = true; },
  } as unknown as Worker));
  await assert.rejects(ocr.recognize("image", 100, 150, 0, controller.signal), { name: "AbortError" });
  assert.ok(terminated);
});

test("failed page processing never creates a completed package", async () => {
  const cache = new IndexedDbComicConversionCache(), key = crypto.randomUUID(); let released = 0;
  await assert.rejects(new ComicConverter().convert({ id: key, title: "Failure", conversionKey: key, totalPages: 2,
    pageProvider: asset, regionProvider: async () => { throw new Error("OCR failed"); }, releasePage: () => { released++; } }, { cache }), /OCR failed/);
  assert.equal(released, 2); assert.equal(await cache.completed(key), undefined); assert.equal(await cache.page(key, 1), undefined);
});

test("interaction files cannot silently refer to another page", async () => {
  const result = await new ComicConverter().convert({ id: "mismatch", title: "Mismatch", totalPages: 1, pageProvider: asset });
  const entries = unzipSync(result.bytes); entries["interaction/001.json"] = strToU8(JSON.stringify({ pageIndex: 9, regions: [] }));
  assert.throws(() => new ComicLimaDeserializer().deserialize(zipSync(entries)), /incorreta/);
});

test("phone and tablet fit to their actual viewport; content hints never crop or distort", () => {
  for (const [width, height] of [[412, 915], [834, 1194], [1194, 834]]) {
    const slot = { x: 0, y: 0, width: width!, height: height! };
    const fit = ComicLayout.presentationFit(slot, 1920, 2951, { x: .1, y: .1, width: .8, height: .8 });
    assert.ok(fit.width <= slot.width + 1e-9 && fit.height <= slot.height + 1e-9);
    assert.ok(Math.abs(fit.width / fit.height - 1920 / 2951) < 1e-9);
    assert.ok(Math.abs(fit.width - slot.width) < 1e-9 || Math.abs(fit.height - slot.height) < 1e-9);
    assert.deepEqual({ ...ComicLayout.contain(slot, 1920, 2951), contentBounds: fit.contentBounds }, fit);
  }
});

test("debug has no visible effect by default", () => {
  drawComicInteractionDebug(new Proxy({}, { get: () => { throw new Error("Unexpected drawing"); } }) as CanvasRenderingContext2D, [region(0)], { x: 0, y: 0, width: 100, height: 150 });
});

// A page painted by hand: a background, boxes of any colour, and rows of little marks
// inside them. Enough to tell a text container from a patch of artwork.
interface Painted { width: number; height: number; data: Uint8ClampedArray; }
const painted = (width: number, height: number, background: [number, number, number]): Painted => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    data[index * 4] = background[0]; data[index * 4 + 1] = background[1]; data[index * 4 + 2] = background[2]; data[index * 4 + 3] = 255;
  }
  return { width, height, data };
};
const fill = (page: Painted, x: number, y: number, w: number, h: number, colour: [number, number, number]): void => {
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
    const offset = (py * page.width + px) * 4;
    page.data[offset] = colour[0]; page.data[offset + 1] = colour[1]; page.data[offset + 2] = colour[2]; page.data[offset + 3] = 255;
  }
};
const writeInto = (page: Painted, x: number, y: number, w: number, h: number, box: [number, number, number], ink: [number, number, number]): void => {
  fill(page, x, y, w, h, box);
  for (let line = 0; line < 3; line++) for (let word = 0; word < 6; word++) {
    fill(page, x + 8 + word * 10, y + 8 + line * 10, 6, 5, ink);
  }
};
const image = (page: Painted): ImageData => ({ width: page.width, height: page.height, data: page.data } as ImageData);

test("um container de texto é encontrado em qualquer cor, e a arte chapada não vira região", () => {
  const page = painted(400, 460, [40, 90, 160]);
  writeInto(page, 30, 30, 80, 46, [253, 253, 253], [20, 20, 20]);    // white balloon
  writeInto(page, 150, 30, 80, 46, [245, 215, 60], [40, 30, 10]);    // yellow caption
  writeInto(page, 30, 140, 80, 46, [200, 30, 30], [255, 250, 240]);  // red box, pale text
  writeInto(page, 150, 140, 80, 46, [12, 12, 14], [250, 250, 250]);  // black box, white text
  fill(page, 40, 260, 120, 120, [220, 120, 40]);                     // a flat orange shape
  fill(page, 60, 300, 80, 40, [140, 60, 10]);                        // with a broad shadow
  const found = detectComicContainers(image(page), { step: 1 });
  const covers = (x: number, y: number): boolean => found.some(c => x >= c.bbox.x0 && x <= c.bbox.x1 && y >= c.bbox.y0 && y <= c.bbox.y1);
  for (const [x, y] of [[70, 53], [190, 53], [70, 163], [190, 163]]) assert.ok(covers(x!, y!), `container em ${x},${y}`);
  assert.ok(!covers(100, 320), "a mancha de arte não é um container");
  // Colour is sampled from the artwork, and the letters are located inside the box.
  const yellow = found.find(c => c.bbox.x0 >= 145 && c.bbox.x0 <= 155)!;
  assert.match(yellow.backgroundColor, /^#f5d73c$/);
  assert.ok(yellow.ink.x0 > yellow.bbox.x0 && yellow.ink.x1 < yellow.bbox.x1);
  assert.ok(yellow.darkOnLight);
  const black = found.find(c => c.bbox.y0 >= 138 && c.bbox.x0 >= 145)!;
  assert.ok(!black.darkOnLight, "texto claro sobre caixa escura");
});

test("caixas vizinhas continuam separadas e a margem da página nunca é um container", () => {
  const page = painted(300, 400, [30, 30, 30]);
  fill(page, 0, 0, 300, 12, [255, 255, 255]);
  writeInto(page, 30, 50, 80, 46, [255, 255, 255], [0, 0, 0]);
  writeInto(page, 140, 50, 80, 46, [255, 255, 255], [0, 0, 0]);
  const found = detectComicContainers(image(page), { step: 1 });
  assert.equal(found.length, 2);
  assert.ok(found[0]!.bbox.x1 < found[1]!.bbox.x0);
  assert.equal(found[0]!.type, "caption");
});

test("a máscara de extração preserva o rabicho estreito que o detector de texto apara", () => {
  const page = painted(400, 460, [30, 60, 140]);
  writeInto(page, 80, 80, 100, 56, [253, 253, 253], [20, 20, 20]);
  // The body is dense; this narrow extension contains no letters but belongs to the art.
  fill(page, 160, 125, 9, 44, [253, 253, 253]);
  const found = detectComicContainers(image(page), { step: 1 });
  const container = found.find(c => c.ink.x0 < 100 && c.ink.y0 < 100)!;
  assert.ok(container);
  assert.ok(container.artBbox && container.artBbox.y1 > container.bbox.y1 + 15);
  const s = container.artStencil!;
  assert.equal(s.data[(160 - s.y) * s.width + 164 - s.x], 1, "rabicho incluído");
  assert.equal(s.data[(160 - s.y) * s.width + 100 - s.x], 0, "cenário ao lado continua transparente");
});

test("o recorte é preparado sem tocar na página, e a polaridade é reconhecida", () => {
  const page = painted(60, 40, [245, 215, 60]);
  for (let word = 0; word < 4; word++) fill(page, 6 + word * 12, 16, 6, 8, [30, 25, 10]);
  const source = image(page);
  const before = source.data.slice();
  const polarity = comicCropPolarity(source);
  assert.equal(polarity.darkOnLight, true);
  const prepared = comicPrepareCrop(source, { mode: "ink", scale: 2, margin: 8 });
  assert.deepEqual(source.data, before, "a imagem original não é alterada");
  assert.equal(prepared.width, 60 * 2 + 16);
  assert.equal(prepared.height, 40 * 2 + 16);
  // Letters end up dark, the box ends up white, and the margin is quiet. A source pixel
  // (x, y) lands on (x * scale + margin, y * scale + margin).
  assert.equal(prepared.data[0], 255);
  const at = (x: number, y: number): number => ((y * 2 + 8) * prepared.width + x * 2 + 8) * 4;
  const centre = at(9, 20);
  assert.ok(prepared.data[centre]! < 60, `tinta escura, veio ${prepared.data[centre]}`);
  const box = at(2, 4);
  assert.ok(prepared.data[box]! > 200, `fundo claro, veio ${prepared.data[box]}`);
  // A dark box is inverted instead, so recognition always sees dark on light.
  const dark = painted(60, 40, [16, 16, 20]);
  for (let word = 0; word < 4; word++) fill(dark, 6 + word * 12, 16, 6, 8, [250, 250, 250]);
  const inverted = comicPrepareCrop(image(dark), { mode: "inverted", scale: 1, margin: 4 });
  const glyph = ((20 + 4) * inverted.width + 9 + 4) * 4;
  assert.ok(inverted.data[glyph]! < 60, `tinta escura, veio ${inverted.data[glyph]}`);
  assert.ok(comicInkThreshold(new Uint8Array([0, 0, 255, 255])) > 0);
});

test("as tentativas de leitura começam pela polaridade certa e ampliam o que é pequeno", () => {
  const small = comicCropPlans(50, 24, true);
  assert.equal(small[0]?.mode, "photo");
  assert.ok(small[0]!.scale >= 3, "uma caixa pequena é ampliada");
  const dark = comicCropPlans(300, 200, false);
  assert.equal(dark[0]?.mode, "inverted");
  assert.ok(dark[0]!.scale <= 2, "uma caixa grande já tem pixels de sobra");
  assert.deepEqual([...new Set(small.map(plan => plan.mode))].sort(), ["ink", "inverted", "photo"]);
});

test("os três retângulos são distintos, e um .lima antigo continua abrindo", () => {
  const modern = comicRegionBounds({ ...region(0), x: .1, y: .1, width: .3, height: .2,
    textBounds: { x: .14, y: .13, width: .2, height: .08 },
    visualBounds: { x: .11, y: .11, width: .28, height: .18 },
    hitBounds: { x: .1, y: .1, width: .3, height: .2 } });
  assert.ok(modern.text.width < modern.visual.width && modern.visual.width < modern.hit.width);
  // Version 1 stored one rectangle: the three collapse onto it instead of guessing.
  const legacy = comicRegionBounds(region(0));
  assert.deepEqual(legacy.text, legacy.visual);
  assert.deepEqual(legacy.visual, legacy.hit);
});

test("cache identity includes source bytes, algorithm version and cover configuration", async () => {
  const source = new Blob(["comic-a"]);
  const key = await comicSourceKey(source, [0]);
  assert.equal(key, await comicSourceKey(source, [0, 0]));
  assert.notEqual(key, await comicSourceKey(source, []));
  assert.notEqual(key, await comicSourceKey(new Blob(["comic-b"]), [0]));
  const cache = new IndexedDbComicConversionCache();
  const customKey = await comicSourceKey(source, [0, 1]);
  const converted = await new ComicConverter().convert({ id: customKey, title: "Configured cover", totalPages: 1, conversionKey: customKey, pageProvider: asset }, { cache });
  assert.equal((await cache.completedForSource(key))?.document.metadata.id, converted.document.metadata.id);
});

const container = (over: Partial<ComicVisualContainer> = {}): ComicVisualContainer => ({
  bbox: { x0: 100, y0: 100, x1: 200, y1: 160 }, ink: { x0: 112, y0: 112, x1: 188, y1: 148 },
  type: "caption", shape: "rectangle", backgroundColor: "#f5d73c", textColor: "#201a08", borderColor: "#7a5a10",
  inkShare: .12, blockShare: .3, runs: 60, glyphShare: .95, bands: 2, darkOnLight: true,
  contour: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 160 }, { x: 100, y: 160 }],
  tail: "none", styleConfidence: .9,
  typography: { family: "comic", weight: "normal", italic: false, align: "center", capHeight: .012, lines: 2 },
  stencil: { data: new Uint8Array(50 * 30).fill(1), width: 50, height: 30, step: 2, x: 100, y: 100 },
  ...over,
});

const reader = (readings: { text: string; confidence: number }[], pageLines: Line[] = []) => {
  const calls: { crop: boolean }[] = [];
  let turn = -1;
  const worker = {
    setParameters: async () => undefined,
    recognize: async (_image: unknown, options: { rectangle?: unknown }) => {
      turn++;
      if (turn === 0) return { data: { text: "", confidence: 0, blocks: blocks([pageLines]) } };
      calls.push({ crop: !options.rectangle });
      const reading = readings[Math.min(turn - 1, readings.length - 1)] ?? { text: "", confidence: 0 };
      return { data: { text: reading.text, confidence: reading.confidence * 100,
        blocks: blocks([[{ ...line(reading.text, 10, 10), words: [{ confidence: reading.confidence * 100 }] } as Line]]) } };
    },
    terminate: async () => undefined,
  } as unknown as Worker;
  return { worker, calls };
};

test("container e texto são reconciliados: a caixa inteira é o alvo, as letras são o texto", async () => {
  const { worker, calls } = reader([{ text: "O QUE ACABOU\nDE ACONTECER?", confidence: .91 }], [line("O QUE ACABOU", 120, 115)]);
  const ocr = new ComicRegionOcr(async () => worker);
  const regions = await ocr.recognize("page", 1000, 1500, 8, undefined, [container()], () => "crop");
  assert.equal(regions.length, 1);
  const found = regions[0]!;
  assert.equal(found.text, "O QUE ACABOU\nDE ACONTECER?");
  const bounds = comicRegionBounds(found);
  // The whole yellow box is what may be touched and what the balloon is made of; the
  // words themselves are a smaller rectangle inside it.
  assert.deepEqual(bounds.visual, { x: .1, y: 100 / 1500, width: .1, height: 60 / 1500 });
  assert.ok(bounds.text.width < bounds.visual.width && bounds.text.height < bounds.visual.height);
  assert.ok(bounds.hit.width > bounds.visual.width && bounds.hit.height > bounds.visual.height);
  assert.equal(found.backgroundColor, "#f5d73c");
  assert.equal(found.textColor, "#201a08");
  assert.equal(found.type, "caption");
  // Confident on the first preparation: the other two are not spent.
  assert.equal(calls.length, 1);
});

test("uma caixa convincente sem leitura sobrevive marcada, e uma mancha qualquer não", async () => {
  const empty = [{ text: "", confidence: 0 }];
  const convincing = new ComicRegionOcr(async () => reader(empty).worker);
  const kept = await convincing.recognize("page", 1000, 1500, 0, undefined, [container()], () => "crop");
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.text, "");
  assert.equal(kept[0]?.recognitionStatus, "needs-review");
  assert.ok(kept[0]?.reviewReasons?.includes("empty-region-pass"));

  const vague = new ComicRegionOcr(async () => reader(empty).worker);
  const dropped = await vague.recognize("page", 1000, 1500, 0, undefined,
    [container({ type: "other", shape: "freeform", inkShare: .02, blockShare: .05, runs: 8, glyphShare: .2, bands: 1 })], () => "crop");
  assert.equal(dropped.length, 0);
});

test("a caixa difícil é tentada de outras formas, e o texto guardado é uma leitura só", async () => {
  const { worker, calls } = reader([
    { text: "", confidence: 0 },
    { text: "ACABOU DE", confidence: .42 },
    { text: "O QUE ACABOU DE ACONTECER", confidence: .88 },
  ]);
  const ocr = new ComicRegionOcr(async () => worker);
  const regions = await ocr.recognize("page", 1000, 1500, 0, undefined, [container({ darkOnLight: false })], () => "crop");
  assert.equal(calls.length, 3, "três preparações diferentes foram tentadas");
  // The best evidence is kept whole. Nothing is stitched together from the attempts.
  assert.equal(regions[0]?.text, "O QUE ACABOU DE ACONTECER");
  assert.ok(!regions[0]?.text.includes("ACABOU DEO"));
});

test("quando o que salvou a leitura foi um preparo alternativo, isso fica registrado", async () => {
  const { worker, calls } = reader([{ text: "", confidence: 0 }, { text: "NÃO... O QUE FOI QUE EU FIZ?", confidence: .9 }]);
  const ocr = new ComicRegionOcr(async () => worker);
  const regions = await ocr.recognize("page", 1000, 1500, 0, undefined, [container()], () => "crop");
  assert.equal(calls.length, 2, "para assim que a leitura convence");
  assert.equal(regions[0]?.text, "NÃO... O QUE FOI QUE EU FIZ?");
  assert.equal(regions[0]?.recognitionStatus, "needs-review");
  assert.ok(regions[0]?.reviewReasons?.includes("prepared-ink"));
});

test("texto sem nenhuma caixa em volta continua virando região", async () => {
  const { worker } = reader([{ text: "WEE-OH WEE-OH", confidence: .8 }], [line("WEE-OH WEE-OH", 400, 300)]);
  const ocr = new ComicRegionOcr(async () => worker);
  const regions = await ocr.recognize("page", 1000, 1500, 0, undefined, [], () => "crop");
  assert.equal(regions.length, 1);
  assert.equal(regions[0]?.type, "free-text");
  assert.equal(regions[0]?.shape, "unknown");
  assert.ok(regions[0]?.reviewReasons?.includes("unverified-boundary"));
});

const maskOf = (width: number, height: number, paint: (set: (x: number, y: number) => void) => void): ComicMask => {
  const data = new Uint8Array(width * height);
  paint((x, y) => { if (x >= 0 && y >= 0 && x < width && y < height) data[y * width + x] = 1; });
  return { width, height, data };
};
const ellipseInto = (set: (x: number, y: number) => void, cx: number, cy: number, rx: number, ry: number): void => {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) set(x, y);
  }
};

test("dois balões desenhados encostados viram dois objetos, um balão com rabicho continua um", () => {
  const joined = maskOf(120, 60, set => { ellipseInto(set, 35, 30, 30, 24); ellipseInto(set, 85, 30, 30, 24); });
  const parts = splitTouchingMasks(joined);
  assert.equal(parts.length, 2);
  const [left, right] = parts.map(maskBounds);
  assert.ok(left!.maxX < right!.minX, "cada um fica com a sua metade, sem pedaço do outro");
  assert.equal(maskArea(parts[0]!) + maskArea(parts[1]!), maskArea(joined), "nenhum pixel se perde nem se repete");

  const tailed = maskOf(120, 60, set => {
    ellipseInto(set, 60, 26, 34, 20);
    for (let y = 40; y < 56; y++) for (let x = 54; x < 60; x++) set(x, y);
  });
  assert.equal(splitTouchingMasks(tailed).length, 1, "o rabicho não é um segundo balão");
});

test("balões fundidos sem linha divisória são separados pelos blocos de texto", () => {
  // One silhouette, two blocks of lettering stacked with a clear gap between them.
  const silhouette = maskOf(120, 90, set => { ellipseInto(set, 45, 30, 40, 26); ellipseInto(set, 75, 62, 40, 26); });
  const ink = maskOf(120, 90, set => {
    for (const [top, left] of [[22, 22], [32, 22], [56, 52], [66, 52], [76, 52]] as const) {
      for (let word = 0; word < 4; word++) for (let y = top; y < top + 4; y++) for (let x = left + word * 9; x < left + word * 9 + 6; x++) set(x, y);
    }
  });
  const parts = splitByTextBlocks(silhouette, ink, 3);
  assert.equal(parts.length, 2);
  const boxes = parts.map(maskBounds).sort((a, b) => a!.minY - b!.minY);
  assert.ok(boxes[0]!.maxY <= boxes[1]!.maxY && boxes[0]!.minY < boxes[1]!.minY);

  // A caption with a little drawing beside its words is one container, never two.
  const caption = maskOf(120, 50, set => { for (let y = 5; y < 45; y++) for (let x = 5; x < 115; x++) set(x, y); });
  const withIcon = maskOf(120, 50, set => {
    for (let y = 12; y < 38; y++) for (let x = 12; x < 34; x++) set(x, y);            // the drawing
    for (const top of [14, 24, 32]) for (let word = 0; word < 5; word++) {
      for (let y = top; y < top + 4; y++) for (let x = 46 + word * 12; x < 46 + word * 12 + 8; x++) set(x, y);
    }
  });
  assert.equal(splitByTextBlocks(caption, withIcon, 3).length, 1, "o ícone pertence à legenda");
});

test("o contorno guardado descreve a forma, e não a caixa em volta dela", () => {
  const oval = maskOf(60, 40, set => ellipseInto(set, 30, 20, 26, 16));
  const contour = simplifyContour(traceMaskContour(oval), 1.1);
  assert.ok(contour.length >= 6 && contour.length < 60, `pontos: ${contour.length}`);
  // Every point of the outline is on the shape's own edge, never out in the artwork.
  for (const point of contour) {
    const inside = ((point.x - 30) / 27) ** 2 + ((point.y - 20) / 17) ** 2;
    assert.ok(inside <= 1.15, `ponto fora da forma: ${JSON.stringify(point)}`);
  }
  const reading = readMaskShape(oval, contour);
  assert.equal(reading.shape, "balloon");
  assert.ok(reading.confidence > .5);

  const box = maskOf(60, 40, set => { for (let y = 4; y < 36; y++) for (let x = 4; x < 56; x++) set(x, y); });
  assert.equal(readMaskShape(box, simplifyContour(traceMaskContour(box), 1.1)).shape, "rectangle");
});

test("uma página com dois balões encostados é convertida em duas regiões independentes", () => {
  const page = painted(520, 400, [30, 60, 140]);
  // Two cream balloons drawn overlapping, each with its own lines of lettering.
  const fillEllipse = (cx: number, cy: number, rx: number, ry: number, colour: [number, number, number]): void => {
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) fill(page, x, y, 1, 1, colour);
    }
  };
  fillEllipse(150, 110, 78, 46, [252, 246, 220]);
  fillEllipse(270, 230, 78, 46, [252, 246, 220]);
  for (const [top, left] of [[95, 100], [111, 100], [215, 220], [231, 220]] as const) {
    for (let word = 0; word < 5; word++) fill(page, left + word * 16, top, 10, 8, [20, 18, 16]);
  }
  const found = detectComicContainers(image(page), { step: 1 });
  assert.equal(found.length, 2, `regiões: ${found.length}`);
  // The two ellipses overlap on the page, yet each region keeps to its own side: the
  // second balloon's box begins below where the first one ends.
  const [first, second] = found;
  assert.ok(first!.bbox.y1 <= second!.bbox.y0 + 2, `caixas ainda misturadas: ${JSON.stringify([first!.bbox, second!.bbox])}`);
  assert.ok(first!.ink.y1 < second!.ink.y0, "cada um ficou com as suas próprias letras");
  for (const container of found) {
    assert.ok(container.contour.length >= 6);
    assert.match(container.backgroundColor, /^#f/);
    assert.ok(container.textColor.length === 7);
  }
});
