import assert from "node:assert/strict";
import { test } from "node:test";
import type { ComicVisualContainer } from "../src/reader/comic/interaction/ComicContainerDetector";
import { comicContainersLookConnected, comicGroupConnectedContainers } from "../src/reader/comic/interaction/ComicContainerGrouping";
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
