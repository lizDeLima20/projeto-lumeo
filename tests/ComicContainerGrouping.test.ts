import assert from "node:assert/strict";
import { test } from "node:test";
import type { ComicVisualContainer } from "../src/reader/comic/interaction/ComicContainerDetector";
import { comicContainersLookConnected, comicGroupConnectedContainers, nearestPoints } from "../src/reader/comic/interaction/ComicContainerGrouping";
import type { ComicPoint2D } from "../src/reader/comic/interaction/ComicShapeMask";
import { readFileSync } from "node:fs";

const balloon = (over: Partial<ComicVisualContainer> & { bbox: ComicVisualContainer["bbox"] }): ComicVisualContainer => {
  const { x0, y0, x1, y1 } = over.bbox;
  const step = 2, width = Math.round((x1 - x0) / step), height = Math.round((y1 - y0) / step);
  return {
    bbox: over.bbox, ink: { x0: x0 + 8, y0: y0 + 8, x1: x1 - 8, y1: y1 - 8 },
    type: "speech", shape: "balloon", backgroundColor: "#ffffff", textColor: "#000000",
    inkShare: .15, blockShare: .3, runs: 60, glyphShare: .95, bands: 2, darkOnLight: true,
    contour: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
    tail: "none", styleConfidence: .9,
    typography: { family: "comic", weight: "normal", italic: false, align: "center", capHeight: .012, lines: 2 },
    stencil: { data: new Uint8Array(Math.max(1, width * height)).fill(1), width: Math.max(1, width), height: Math.max(1, height), step, x: x0, y: y0 },
    ...over,
  };
};

/** The task's own diagram: an upper balloon, a lower balloon, a short gap between them -
 *  the case two connected balloons used to open together and, after the last change,
 *  stopped. */
test("uma cadeia vertical de dois balões separados por um vão curto é lida como um grupo", () => {
  const upper = balloon({ bbox: { x0: 100, y0: 100, x1: 300, y1: 200 } });
  const lower = balloon({ bbox: { x0: 100, y0: 206, x1: 300, y1: 300 } });
  assert.ok(comicContainersLookConnected(upper, lower));
  const grouped = comicGroupConnectedContainers([upper, lower]);
  assert.equal(grouped.length, 1, "as duas viram um único contêiner");
  const merged = grouped[0]!;
  // The union covers both balloons and the bridge between them.
  assert.ok(merged.bbox.x0 <= 100 && merged.bbox.x1 >= 300);
  assert.ok(merged.bbox.y0 <= 100 && merged.bbox.y1 >= 300);
  for (const point of [{ x: 200, y: 130 }, { x: 200, y: 260 }, { x: 200, y: 203 }]) {
    let inside = false;
    for (let index = 0, previous = merged.contour.length - 1; index < merged.contour.length; previous = index++) {
      const a = merged.contour[index]!, b = merged.contour[previous]!;
      if ((a.y > point.y) === (b.y > point.y)) continue;
      if (point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    assert.ok(inside, `ponto (${point.x},${point.y}) deveria estar dentro do contorno unido`);
  }
});

test("um balão independente entre dois conectados continua fora do grupo", () => {
  const upper = balloon({ bbox: { x0: 100, y0: 100, x1: 300, y1: 200 } });
  const lower = balloon({ bbox: { x0: 100, y0: 206, x1: 300, y1: 300 } });
  const middle = balloon({ bbox: { x0: 340, y0: 150, x1: 420, y1: 190 }, backgroundColor: "#ffe9a8" });
  const grouped = comicGroupConnectedContainers([upper, lower, middle]);
  assert.equal(grouped.length, 2, "o balão do meio não entra no grupo");
  assert.ok(grouped.some(container => container.bbox.x0 === 340));
});

test("balões distantes, mesmo da mesma cor, não são unidos", () => {
  const a = balloon({ bbox: { x0: 100, y0: 100, x1: 200, y1: 160 } });
  const b = balloon({ bbox: { x0: 100, y0: 900, x1: 200, y1: 960 } });
  assert.equal(comicGroupConnectedContainers([a, b]).length, 2);
});

test("balões desalinhados, sem sobreposição no eixo cruzado, não são unidos", () => {
  const a = balloon({ bbox: { x0: 100, y0: 100, x1: 200, y1: 160 } });
  const b = balloon({ bbox: { x0: 900, y0: 166, x1: 1000, y1: 226 } });
  assert.equal(comicGroupConnectedContainers([a, b]).length, 2);
});

test("caixas de legenda (retângulos) não são fundidas por proximidade", () => {
  const a = balloon({ bbox: { x0: 100, y0: 100, x1: 300, y1: 200 }, type: "caption", shape: "rectangle" });
  const b = balloon({ bbox: { x0: 100, y0: 206, x1: 300, y1: 300 }, type: "caption", shape: "rectangle" });
  assert.equal(comicGroupConnectedContainers([a, b]).length, 2);
});

test("cores muito diferentes não são a mesma fala", () => {
  const a = balloon({ bbox: { x0: 100, y0: 100, x1: 300, y1: 200 }, backgroundColor: "#ffffff" });
  const b = balloon({ bbox: { x0: 100, y0: 206, x1: 300, y1: 300 }, backgroundColor: "#ff2200" });
  assert.equal(comicGroupConnectedContainers([a, b]).length, 2);
});

test("três balões em cadeia viram um só grupo", () => {
  const top = balloon({ bbox: { x0: 100, y0: 100, x1: 300, y1: 180 } });
  const mid = balloon({ bbox: { x0: 100, y0: 186, x1: 300, y1: 266 } });
  const bottom = balloon({ bbox: { x0: 100, y0: 272, x1: 300, y1: 352 } });
  assert.equal(comicGroupConnectedContainers([top, mid, bottom]).length, 1);
});

test("OCR e o recorte final leem os mesmos contêineres, já agrupados", () => {
  const source = readFileSync(new URL("../src/reader/comic/interaction/ComicPageRegionReader.ts", import.meta.url), "utf8");
  assert.match(source, /const containers = comicGroupConnectedContainers\(found\);/);
  // Both consumers read the grouped list, never the raw detector output.
  assert.match(source, /ocr\.recognize\(whole, canvas\.width, canvas\.height, pageIndex, signal, containers,/);
  assert.match(source, /comicCreateOriginalCutouts\(canvas, regions, containers, encoded\)/);
  assert.doesNotMatch(source, /ocr\.recognize\([^)]*\bfound\b/);
  assert.doesNotMatch(source, /comicCreateOriginalCutouts\([^)]*\bfound\b/);
});

// A real page, painted by hand: two white balloons stacked with a short gap and nothing
// drawn between them - exactly what the detector itself finds, not a hand-built container.
interface Painted { width: number; height: number; data: Uint8ClampedArray; }
const paintedPage = (width: number, height: number, background: [number, number, number]): Painted => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    data[index * 4] = background[0]; data[index * 4 + 1] = background[1]; data[index * 4 + 2] = background[2]; data[index * 4 + 3] = 255;
  }
  return { width, height, data };
};
const fillBox = (page: Painted, x: number, y: number, w: number, h: number, colour: [number, number, number]): void => {
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
    const offset = (py * page.width + px) * 4;
    page.data[offset] = colour[0]; page.data[offset + 1] = colour[1]; page.data[offset + 2] = colour[2]; page.data[offset + 3] = 255;
  }
};
const letteredOval = (page: Painted, cx: number, cy: number, rx: number, ry: number): void => {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) fillBox(page, x, y, 1, 1, [253, 253, 253]);
  }
  for (let line = 0; line < 3; line++) for (let word = 0; word < 4; word++) fillBox(page, cx - rx * .55 + word * 12, cy - 12 + line * 10, 6, 5, [20, 20, 20]);
};
const asImage = (page: Painted): ImageData => ({ width: page.width, height: page.height, data: page.data } as ImageData);

/** A balloon far smaller than the ones it joins - the case a coarse merge grid can miss
 *  outright, leaving it "in the group" by name but with no silhouette of its own to answer
 *  a touch. */
test("um lóbulo minúsculo do grupo continua com silhueta própria depois da fusão", () => {
  const big = balloon({ bbox: { x0: 100, y0: 100, x1: 400, y1: 260 }, stencil: { data: new Uint8Array(1).fill(1), width: 1, height: 1, step: 6, x: 100, y: 100 } });
  // A tiny lobe, narrower than the big balloon's own 6px grid step, chained right below it.
  const tiny = balloon({ bbox: { x0: 220, y0: 264, x1: 236, y1: 278 }, stencil: { data: new Uint8Array(1).fill(1), width: 1, height: 1, step: 6, x: 220, y: 264 } });
  assert.ok(comicContainersLookConnected(big, tiny), "o vão de 4px entre os dois é curto o bastante para ligar");
  const grouped = comicGroupConnectedContainers([big, tiny]);
  assert.equal(grouped.length, 1);
  const merged = grouped[0]!;
  const insideMerged = (point: { x: number; y: number }): boolean => {
    let inside = false;
    for (let index = 0, previous = merged.contour.length - 1; index < merged.contour.length; previous = index++) {
      const a = merged.contour[index]!, b = merged.contour[previous]!;
      if ((a.y > point.y) === (b.y > point.y)) continue;
      if (point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
  // The tiny lobe's own centre must still be part of the merged silhouette, not lost to
  // a rasterisation grid too coarse for something this small.
  assert.ok(insideMerged({ x: 228, y: 271 }), "o centro do lóbulo minúsculo ficou fora do contorno unido");
});

// A closed rectangular contour, corners in order - the same shape `balloon()` already
// gives its containers, used here on its own to test the geometry directly.
const rect = (x0: number, y0: number, x1: number, y1: number): ComicPoint2D[] =>
  [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

test("A) retângulo pequeno perto do MEIO de uma borda longa do retângulo grande: a distância é o vão real, não a diagonal até uma quina", () => {
  const big = rect(100, 100, 400, 260);
  // Centred under the big rectangle's bottom edge (x: 100-400), 4px below it - nowhere
  // near either bottom corner.
  const small = rect(220, 264, 236, 278);
  assert.equal(nearestPoints(big, small).distance, 4);
});

test("B) o mesmo vão, agora perto de uma quina: a resposta continua exata", () => {
  const big = rect(100, 100, 400, 260);
  const small = rect(100, 264, 116, 278);
  assert.equal(nearestPoints(big, small).distance, 4);
});

test("C) dois contornos realmente distantes não ficam perto por engano", () => {
  const a = rect(0, 0, 50, 50);
  const b = rect(2000, 2000, 2050, 2050);
  const distance = nearestPoints(a, b).distance;
  assert.ok(distance > 2500, `deveria estar muito longe, mediu ${distance}`);
});

test("D) segmentos que se tocam medem distância zero", () => {
  const a = rect(0, 0, 100, 100);
  // Shares its whole left edge with a's right edge - a real touch, not a near miss.
  const b = rect(100, 0, 200, 100);
  assert.equal(nearestPoints(a, b).distance, 0);
});

test("E) contornos que se cruzam medem distância zero", () => {
  const a = rect(0, 0, 100, 100);
  const b = rect(50, 50, 150, 150);
  assert.equal(nearestPoints(a, b).distance, 0);
});

test("F) contorno pequeno perto de uma borda bem mais longa que a dele", () => {
  const wall = rect(0, 0, 2000, 40);
  const small = rect(950, 46, 966, 60);
  assert.equal(nearestPoints(wall, small).distance, 6);
});

test("G) a ordem não muda a distância mínima: nearestPoints(A,B) === nearestPoints(B,A)", () => {
  const cases: [ComicPoint2D[], ComicPoint2D[]][] = [
    [rect(100, 100, 400, 260), rect(220, 264, 236, 278)],
    [rect(0, 0, 50, 50), rect(2000, 2000, 2050, 2050)],
    [rect(0, 0, 100, 100), rect(100, 0, 200, 100)],
    [rect(0, 0, 100, 100), rect(50, 50, 150, 150)],
    [rect(0, 0, 2000, 40), rect(950, 46, 966, 60)],
  ];
  for (const [a, b] of cases) {
    const forward = nearestPoints(a, b).distance, backward = nearestPoints(b, a).distance;
    assert.ok(Math.abs(forward - backward) < 1e-9, `direto ${forward} vs invertido ${backward}`);
  }
});

test("segmentos degenerados (comprimento zero) não geram NaN nem Infinity", () => {
  const point: ComicPoint2D[] = [{ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 }];
  const result = nearestPoints(point, rect(50, 50, 60, 60));
  assert.ok(Number.isFinite(result.distance));
  assert.ok(!Number.isNaN(result.distance));
});

test("na página real, dois balões separados por um vão curto são detectados soltos e depois lidos como um só", async () => {
  const { detectComicContainers } = await import("../src/reader/comic/interaction/ComicContainerDetector");
  const page = paintedPage(400, 520, [30, 60, 110]);
  letteredOval(page, 160, 120, 100, 65);
  letteredOval(page, 160, 260, 100, 65);
  const found = detectComicContainers(asImage(page));
  assert.equal(found.length, 2, `o detector real encontra os dois balões separados, sem ligação entre eles: ${JSON.stringify(found.map(c => ({ type: c.type, shape: c.shape })))}`);
  assert.ok(found.every(c => c.type === "speech" || c.type === "thought"), "ambos lidos como fala, não legenda");
  const grouped = comicGroupConnectedContainers(found);
  assert.equal(grouped.length, 1, "o agrupamento reúne o que o detector separou");
});

// Reproduces the reported bug: a balloon whose fill got cut in two by something inside it
// (heavy lettering, a drop shadow, a highlight) - one piece reads correctly as the balloon
// (type "speech"), the other, small and densely filled, misreads on its own as a caption
// (type "caption", shape "rectangle"). Before this fix the strict `a.type === b.type` gate
// left the second piece permanently separate: its word became the popup's entire text, and
// its pixels became a hole carved into the balloon that was shown.
test("um fragmento que leu como legenda, mas é a metade de um balão de fala, ainda assim se funde com o vizinho do mesmo tom", () => {
  const main = balloon({ bbox: { x0: 100, y0: 100, x1: 300, y1: 220 }, type: "speech", shape: "balloon" });
  // "FEIOSO!" cut off on its own, 2px away - a wall-split sliver, not a real gap.
  const word = balloon({ bbox: { x0: 140, y0: 222, x1: 220, y1: 250 }, type: "caption", shape: "rectangle" });
  assert.ok(comicContainersLookConnected(main, word), "o par deveria ler como conectado");
  const grouped = comicGroupConnectedContainers([main, word]);
  assert.equal(grouped.length, 1, "o fragmento mal-classificado deveria se juntar ao balão");
  assert.equal(grouped[0]!.type, "speech", "o grupo fica com o tipo do maior dos dois - a fala em si");
});

test("mas uma legenda de verdade, de cor diferente, continua separada mesmo colada a um balão", () => {
  const main = balloon({ bbox: { x0: 100, y0: 100, x1: 300, y1: 220 }, type: "speech", shape: "balloon" });
  const unrelated = balloon({ bbox: { x0: 140, y0: 222, x1: 220, y1: 250 }, type: "caption", shape: "rectangle", backgroundColor: "#ffe9a8" });
  assert.equal(comicGroupConnectedContainers([main, unrelated]).length, 2, "cores diferentes nunca se fundem, por mais perto que estejam");
});

test("duas legendas de verdade, coladas uma na outra, continuam duas - nenhuma é fala", () => {
  const a = balloon({ bbox: { x0: 100, y0: 100, x1: 220, y1: 150 }, type: "caption", shape: "rectangle" });
  const b = balloon({ bbox: { x0: 220, y0: 100, x1: 340, y1: 150 }, type: "caption", shape: "rectangle" });
  assert.equal(comicGroupConnectedContainers([a, b]).length, 2, "sem nenhum lado confirmado como fala, o encosto sozinho não basta");
});
