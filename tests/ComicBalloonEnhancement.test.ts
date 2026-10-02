import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { comicAnalyzeBalloonQuality } from "../src/reader/comic/interaction/ComicBalloonQuality";
import { comicEnhanceBalloonImage, comicPlanBalloonEnhancement } from "../src/reader/comic/interaction/ComicBalloonEnhancer";

const source = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

interface Rect { x: number; y: number; w: number; h: number; }
interface PaintOptions {
  width: number; height: number;
  background: [number, number, number];
  ink?: [number, number, number];
  strokes?: Rect[];
  /** 0..1: per-pixel jitter amplitude, deterministic (seeded), not Math.random - a test run
   *  must be exactly reproducible. */
  noise?: number;
  /** Box-blur passes applied after painting - a cheap, repeatable stand-in for an
   *  out-of-focus or soft-contact scan. */
  blurPasses?: number;
}

/** A tiny synthetic "balloon": a flat background with a few drawn strokes standing in for
 *  letters, painted fully opaque (as a real cutout's interior always is) so every pixel
 *  counts toward the metrics. No canvas, no DOM - a plain RGBA buffer the analysis and
 *  enhancement functions read exactly as they would a real decoded crop. */
function paintBalloon(options: PaintOptions): ImageData {
  const { width, height, background, ink = [20, 20, 20], strokes = [] } = options;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = background[0]; data[i * 4 + 1] = background[1]; data[i * 4 + 2] = background[2]; data[i * 4 + 3] = 255;
  }
  for (const stroke of strokes) {
    for (let y = stroke.y; y < stroke.y + stroke.h && y < height; y++) for (let x = stroke.x; x < stroke.x + stroke.w && x < width; x++) {
      if (x < 0 || y < 0) continue;
      const i = (y * width + x) * 4;
      data[i] = ink[0]; data[i + 1] = ink[1]; data[i + 2] = ink[2];
    }
  }
  if (options.noise) {
    let state = 1;
    const next = (): number => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff; };
    const amplitude = options.noise * 40;
    for (let i = 0; i < width * height; i++) for (let channel = 0; channel < 3; channel++) {
      const index = i * 4 + channel;
      data[index] = Math.max(0, Math.min(255, data[index]! + (next() - .5) * amplitude));
    }
  }
  for (let pass = 0; pass < (options.blurPasses ?? 0); pass++) {
    const copy = new Uint8ClampedArray(data);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(width - 1, x + 1), y0 = Math.max(0, y - 1), y1 = Math.min(height - 1, y + 1);
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0, count = 0;
        for (let ny = y0; ny <= y1; ny++) for (let nx = x0; nx <= x1; nx++) { sum += copy[(ny * width + nx) * 4 + channel]!; count++; }
        data[(y * width + x) * 4 + channel] = sum / count;
      }
    }
  }
  return { width, height, data } as ImageData;
}

/** A plain line of text: a row of short, well-separated strokes, like several letters. */
function textLine(y: number, height: number, count: number, startX = 10, gap = 14): Rect[] {
  return Array.from({ length: count }, (_, index) => ({ x: startX + index * gap, y, w: 8, h: height }));
}

function maxChannelDelta(a: ImageData, b: ImageData): number {
  let max = 0;
  for (let i = 0; i < a.data.length; i += 4) for (let channel = 0; channel < 3; channel++) {
    max = Math.max(max, Math.abs(a.data[i + channel]! - b.data[i + channel]!));
  }
  return max;
}

function clone(image: ImageData): ImageData {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) } as ImageData;
}

// 1. Black text, crisp, on white: the "already excellent" case.
test("1. texto preto nítido em fundo branco: a análise lê alto contraste e nitidez, quase nada é aplicado", () => {
  const image = paintBalloon({ width: 120, height: 60, background: [252, 252, 250], strokes: textLine(20, 20, 6) });
  const metrics = comicAnalyzeBalloonQuality(image);
  assert.ok(metrics.contrast > .7, `contraste deveria ler alto, leu ${metrics.contrast.toFixed(2)}`);
  assert.ok(metrics.darkOnLight);
  assert.equal(metrics.neutralBackground, true);
  const plan = comicPlanBalloonEnhancement(metrics, .95);
  assert.ok(plan.sharpen < .25 && plan.contrast < .25 && plan.whiten < .2,
    `um scan já ótimo não deveria pedir um tratamento forte (plan=${JSON.stringify(plan)})`);
});

// 2. Faded, low-contrast grey text on a yellowed background.
test("2. texto desbotado em fundo amarelado: lido como fundo neutro, contraste baixo, clareamento acionado", () => {
  const image = paintBalloon({ width: 120, height: 60, background: [230, 221, 191], ink: [140, 132, 108], strokes: textLine(20, 20, 6) });
  const metrics = comicAnalyzeBalloonQuality(image);
  assert.ok(metrics.contrast < .55, `um scan desbotado deveria ler contraste baixo, leu ${metrics.contrast.toFixed(2)}`);
  assert.equal(metrics.neutralBackground, true, "papel amarelado ainda é fundo neutro, não uma caixa colorida");
  assert.ok(metrics.darkOnLight);
  const plan = comicPlanBalloonEnhancement(metrics, .4);
  assert.ok(plan.whiten > .2, `um fundo amarelado e desbotado deveria pedir clareamento real (whiten=${plan.whiten.toFixed(2)})`);
  assert.ok(plan.contrast > .2);
});

// 3. A blurred scan: sharpness should read low, and the plan should ask to sharpen.
test("3. texto com blur: nitidez lida baixa, plano pede nitidez controlada", () => {
  const sharp = paintBalloon({ width: 120, height: 60, background: [250, 250, 248], strokes: textLine(20, 24, 6) });
  const blurred = paintBalloon({ width: 120, height: 60, background: [250, 250, 248], strokes: textLine(20, 24, 6), blurPasses: 6 });
  const sharpMetrics = comicAnalyzeBalloonQuality(sharp), blurredMetrics = comicAnalyzeBalloonQuality(blurred);
  assert.ok(blurredMetrics.sharpness < sharpMetrics.sharpness, "um scan borrado deveria medir menos nítido que o original");
  const plan = comicPlanBalloonEnhancement(blurredMetrics);
  assert.ok(plan.sharpen > 0, "um scan borrado deveria pedir alguma nitidez");
});

// 4. Scan noise/grain in the background.
test("4. ruído de scan: lido no fundo, plano pede denoise sem tocar o traço", () => {
  const clean = paintBalloon({ width: 120, height: 60, background: [248, 248, 246], strokes: textLine(20, 20, 6) });
  const noisy = paintBalloon({ width: 120, height: 60, background: [248, 248, 246], strokes: textLine(20, 20, 6), noise: .6 });
  const cleanMetrics = comicAnalyzeBalloonQuality(clean), noisyMetrics = comicAnalyzeBalloonQuality(noisy);
  assert.ok(noisyMetrics.noise > cleanMetrics.noise, "o ruído introduzido deveria ler mais alto que o scan limpo");
  const plan = comicPlanBalloonEnhancement(noisyMetrics);
  assert.ok(plan.denoise > 0, "um fundo ruidoso deveria pedir alguma suavização");
  const enhanced = comicEnhanceBalloonImage(clone(noisy), plan);
  // The interior of a stroke - away from its own edge, where sharpening is expected to
  // push contrast further - must stay clearly dark: denoise only ever touches pixels near
  // the background tone, and nothing here softens real ink into the page.
  for (const stroke of textLine(20, 20, 6)) {
    const i = ((stroke.y + 10) * noisy.width + stroke.x + 4) * 4;
    assert.ok(enhanced.data[i]! < 80, `o interior de um traço deveria continuar escuro, leu ${enhanced.data[i]}`);
  }
});

// 5. Small text: thin, short strokes must survive the whole pipeline without disappearing.
test("5. texto pequeno: traços finos continuam presentes depois do realce completo", () => {
  const image = paintBalloon({ width: 80, height: 40, background: [230, 218, 178], ink: [90, 80, 60],
    strokes: Array.from({ length: 8 }, (_, index) => ({ x: 6 + index * 9, y: 16, w: 2, h: 10 })) });
  const metrics = comicAnalyzeBalloonQuality(image);
  const plan = comicPlanBalloonEnhancement(metrics, .3);
  const enhanced = comicEnhanceBalloonImage(clone(image), plan);
  let darkPixels = 0;
  for (let i = 0; i < enhanced.data.length; i += 4) if (enhanced.data[i]! < 150) darkPixels++;
  assert.ok(darkPixels > 0, "as letras finas não podem desaparecer depois do realce");
});

// 6. A coloured caption/narration box: colour must survive, never forced to white.
test("6. caixa colorida (narração): cor preservada, nunca clareada como se fosse papel neutro", () => {
  const image = paintBalloon({ width: 120, height: 60, background: [214, 108, 40], ink: [255, 255, 255], strokes: textLine(20, 20, 6) });
  const metrics = comicAnalyzeBalloonQuality(image);
  assert.equal(metrics.neutralBackground, false, "uma caixa de narração laranja não é fundo neutro");
  const plan = comicPlanBalloonEnhancement(metrics);
  assert.equal(plan.whiten, 0, "uma caixa colorida nunca é clareada em direção ao branco");
  const enhanced = comicEnhanceBalloonImage(clone(image), plan);
  const i = (5 * image.width + 5) * 4; // a background pixel, away from any stroke
  assert.ok(enhanced.data[i]! > enhanced.data[i + 2]!, "o fundo continua claramente laranja (R > B), não embranquecido");
});

// 7 & 8. Thin outline / tail: a lone thin dark stroke near the background tone must not be
// erased by denoise, and the background right next to it is still touched normally.
test("7/8. contorno fino e rabicho: um traço isolado perto do fundo nunca é apagado pelo denoise", () => {
  const image = paintBalloon({ width: 100, height: 60, background: [245, 240, 225], ink: [60, 55, 45],
    strokes: [{ x: 48, y: 0, w: 2, h: 60 }, { x: 30, y: 54, w: 20, h: 4 }], noise: .3 }); // a tail-like diagonal-ish stub
  const metrics = comicAnalyzeBalloonQuality(image);
  const plan = comicPlanBalloonEnhancement(metrics, .5);
  const enhanced = comicEnhanceBalloonImage(clone(image), plan);
  const outline = (30 * image.width + 48) * 4;
  assert.ok(enhanced.data[outline]! < 150, "o contorno fino continua escuro, não foi apagado pela suavização do fundo");
});

// 9. An already-perfect scan must not be made worse: no visible change past a small cap.
test("9. original já perfeito: o realce não piora - a mudança fica pequena", () => {
  const image = paintBalloon({ width: 120, height: 60, background: [255, 255, 255], strokes: textLine(20, 22, 6) });
  const metrics = comicAnalyzeBalloonQuality(image);
  const plan = comicPlanBalloonEnhancement(metrics, .97);
  const before = clone(image);
  const enhanced = comicEnhanceBalloonImage(clone(image), plan);
  assert.ok(maxChannelDelta(before, enhanced) < 40, "um scan já perfeito não deveria mudar muito, se mudar");
});

// 10. Enhancement failure must fall back to the original crop, never block the balloon.
test("10. falha no realce cai para o recorte original, nunca impede o balão de abrir", () => {
  const view = source("reader/comic/interaction/ComicBubbleView.ts");
  assert.match(view, /catch \{ return \{ canvas: original, fallback \}; \}/);
});

// 11. Resolution/memory limits: the enhancement works at a bubble-sized resolution, never
// the full page, and the artwork cache is bounded.
test("11. limites de resolução/memória: processamento só no tamanho do balão, cache limitado", () => {
  const view = source("reader/comic/interaction/ComicBubbleView.ts");
  assert.match(view, /const ARTWORK_CACHE_LIMIT = 8;/);
  assert.match(view, /this\.artworkCache\.delete\(this\.artworkCache\.keys\(\)\.next\(\)\.value!\)/);
  // The enhancement pass reads an ImageData already sized to the bubble's own display
  // target, never the full decoded page.
  const enhancer = source("reader/comic/interaction/ComicBalloonEnhancer.ts");
  assert.doesNotMatch(enhancer, /canvas\.width\s*=\s*.*page|fullPage|wholePage/i);
});

// Enhancement never touches region geometry, grouping or stored text - it only ever reads
// and writes pixel buffers that are not part of the .lima document at all.
test("o realce nunca referencia bounds, contorno, bubbleGroup ou o texto armazenado da região", () => {
  const enhancer = source("reader/comic/interaction/ComicBalloonEnhancer.ts");
  const quality = source("reader/comic/interaction/ComicBalloonQuality.ts");
  for (const forbidden of [/region\.text\s*=/, /region\.contour\s*=/, /region\.bubbleGroup\s*=/, /region\.x\s*=|region\.y\s*=|region\.width\s*=|region\.height\s*=/]) {
    assert.doesNotMatch(enhancer, forbidden);
    assert.doesNotMatch(quality, forbidden);
  }
});

// The fallback crop path (no precomputed asset yet) is enhanced exactly like any other -
// legibility does not depend on which source the artwork came from.
test("o recorte de reserva (sem asset pré-computado) também passa pelo mesmo realce", () => {
  const view = source("reader/comic/interaction/ComicBubbleView.ts");
  assert.match(view, /function comicPrepareBubbleArtwork\(region: ComicTextRegion, width: number, height: number, art: ComicOriginalArt\)/);
  assert.doesNotMatch(view, /if \(art\.fallback\) return/);
});

// The reader is never asked to judge the enhancement: one version reaches the popup, the
// better one, chosen before the balloon ever opens - not a switch, not a label, not a word
// that admits the pixels were touched.
test("não existe alternância Original/Melhorado nem qualquer rótulo técnico visível no popup", () => {
  const view = source("reader/comic/interaction/ComicBubbleView.ts");
  const css = source("styles/comic.css");
  // Quoted strings only - "Original" and "melhorado" read fine in a comment explaining the
  // architecture, but must never appear as a literal a reader could end up looking at.
  for (const forbidden of [/["']Original["']/, /["']Melhorado["']/, /comic-bubble__toggle/, /buildToggle/, /showingOriginal/]) {
    assert.doesNotMatch(view, forbidden, `ComicBubbleView.ts não deveria conter ${forbidden}`);
    assert.doesNotMatch(css, forbidden, `comic.css não deveria conter ${forbidden}`);
  }
  // build() appends exactly the one canvas - no second element (a button, a badge) beside it.
  const build = view.slice(view.indexOf("public static build("), view.indexOf("private retire("));
  assert.match(build, /element\.append\(canvas\);/);
  assert.doesNotMatch(build, /element\.append\([^)]*,/, "build() não deveria anexar um segundo elemento ao lado do canvas");
});

// A balloon's own debug outline (speech/thought/caption bounds) only ever paints when the
// reader explicitly turned development visualization on - never by default, never because
// a stray flag happened to survive from someone else's session.
test("os contornos de depuração exigem a flag explícita e nunca aparecem por padrão", () => {
  const view = source("views/ComicReaderView.ts");
  assert.match(view, /localStorage\.getItem\("lumeo\.comic\.debug"\) === "1" \|\| new URLSearchParams\(location\.search\)\.get\("comicDebug"\) === "1"/);
  const css = source("styles/comic.css");
  // The base region rule itself never draws an outline - the line reads its own full
  // declaration block, closing brace included, with nothing coloured in it. Only the
  // keyboard-focus state (real accessibility) and the "--debug" modifier, gated by the
  // flag above, ever do.
  const base = css.match(/^\.comic-hitmap__target \{[^}]*\}/m)?.[0] ?? "";
  assert.ok(base, "a regra base de .comic-hitmap__target deveria existir");
  assert.doesNotMatch(base, /outline/);
  assert.match(css, /\.comic-hitmap--debug \.comic-hitmap__target \{[^}]*outline/);
});
