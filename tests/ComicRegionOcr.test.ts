import assert from "node:assert/strict";
import { test } from "node:test";
import type { ComicVisualContainer } from "../src/reader/comic/interaction/ComicContainerDetector";
import { comicSeedBelongsToContainer } from "../src/reader/comic/interaction/ComicRegionOcr";

const container = (over: Partial<ComicVisualContainer> & { bbox: ComicVisualContainer["bbox"] }): ComicVisualContainer => {
  const { x0, y0, x1, y1 } = over.bbox;
  const step = 2, width = Math.round((x1 - x0) / step), height = Math.round((y1 - y0) / step);
  return {
    bbox: over.bbox, ink: { x0: x0 + 8, y0: y0 + 8, x1: x1 - 8, y1: y1 - 8 },
    type: "thought", shape: "cloud", backgroundColor: "#ffffff", textColor: "#000000",
    inkShare: .15, blockShare: .3, runs: 60, glyphShare: .95, bands: 2, darkOnLight: true,
    contour: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
    tail: "none", styleConfidence: .9,
    typography: { family: "comic", weight: "normal", italic: false, align: "center", capHeight: .012, lines: 2 },
    stencil: { data: new Uint8Array(Math.max(1, width * height)).fill(1), width: Math.max(1, width), height: Math.max(1, height), step, x: x0, y: y0 },
    ...over,
  };
};

/** The real case found on a page of "Os Vingadores #290": a cloud-shaped thought balloon
 *  whose last word, "LENÇOIS!", sat a few pixels below the flood fill's own traced edge -
 *  cramped lettering the fill's colour tolerance did not reach. Requiring the word's centre
 *  to land exactly on or inside the contour turned it into an orphan "free-text" region,
 *  with no container to open the whole balloon from: tapping anywhere else in the balloon
 *  opened "AQUELE SUJEITO ALI ESTÁ EM MAUS" without its last word, and tapping the word
 *  itself opened only "LENÇOIS!" on its own. */
test("uma palavra alguns pixels fora do contorno, mas dentro da caixa do balão, ainda conta como parte dele", () => {
  // The bbox runs to y1=250 (another bump of the cloud reaches that far) while this
  // straight edge only traces to y=240 - "LENÇOIS!" sat a few pixels into that gap.
  const balloon = container({ bbox: { x0: 100, y0: 100, x1: 300, y1: 250 },
    contour: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 240 }, { x: 100, y: 240 }],
    stencil: { data: new Uint8Array(1), width: 1, height: 1, step: 1, x: 100, y: 100 } });
  const word = { bbox: { x0: 170, y0: 242.5, x1: 230, y1: 250.5 } };
  assert.ok(comicSeedBelongsToContainer(word, balloon));
});

/** The real case found on a page of "[1963] - Os Vingadores", Volume 1 (057-058.cbr): a
 *  thought-cloud's own scalloped outline bites inward right in the MIDDLE of its text, not
 *  just at a cramped edge - "EMOÇÕES", the fourth word of five lines, sat in that notch and
 *  became its own orphan region, opening by itself instead of the whole thought ("PARA UM
 *  SER DESPIDO DE EMOÇÕES VOCÊ ME ATACOU ENRAIVECIDO DEMAIS, ULTRON..."). A fixed pixel
 *  hairline missed this because the notch here runs deeper than the one "LENÇOIS!" sat in. */
test("uma palavra no meio da frase, numa reentrância do contorno, ainda conta como parte do balão", () => {
  // A cloud bitten inward between two lobes: the contour excludes x=190..210 at this row,
  // and the word sits at x=193..207 - squarely inside that notch, not grazing its edge.
  const balloon = container({ bbox: { x0: 100, y0: 100, x1: 300, y1: 260 },
    contour: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 260 }, { x: 210, y: 260 },
      { x: 210, y: 200 }, { x: 190, y: 200 }, { x: 190, y: 260 }, { x: 100, y: 260 }] });
  const word = { bbox: { x0: 193, y0: 203, x1: 207, y1: 217 } };
  assert.ok(comicSeedBelongsToContainer(word, balloon));
});

test("mas a mesma palavra, se o contorno de um balão vizinho a reivindica, fica com o vizinho", () => {
  const balloon = container({ bbox: { x0: 100, y0: 100, x1: 300, y1: 260 },
    contour: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 260 }, { x: 210, y: 260 },
      { x: 210, y: 200 }, { x: 190, y: 200 }, { x: 190, y: 260 }, { x: 100, y: 260 }] });
  // A genuinely different balloon, tucked into the notch, whose own outline really does
  // contain the word - this is the case the sibling check exists to protect.
  const neighbour = container({ bbox: { x0: 160, y0: 190, x1: 240, y1: 230 },
    contour: [{ x: 160, y: 190 }, { x: 240, y: 190 }, { x: 240, y: 230 }, { x: 160, y: 230 }] });
  const word = { bbox: { x0: 193, y0: 203, x1: 207, y1: 217 } };
  assert.equal(comicSeedBelongsToContainer(word, balloon, [balloon, neighbour]), false);
  assert.ok(comicSeedBelongsToContainer(word, neighbour, [balloon, neighbour]));
});

test("uma palavra bem longe do contorno não é puxada para dentro do balão", () => {
  const balloon = container({ bbox: { x0: 100, y0: 100, x1: 300, y1: 240 } });
  // Outside the balloon's own box entirely: a real caption sitting its own real distance
  // away must stay its own region.
  const caption = { bbox: { x0: 170, y0: 400, x1: 230, y1: 420 } };
  assert.equal(comicSeedBelongsToContainer(caption, balloon), false);
});

test("uma palavra dentro do contorno sempre conta, como antes", () => {
  const balloon = container({ bbox: { x0: 100, y0: 100, x1: 300, y1: 240 } });
  const word = { bbox: { x0: 170, y0: 150, x1: 230, y1: 170 } };
  assert.ok(comicSeedBelongsToContainer(word, balloon));
});

test("uma palavra fora da própria caixa do balão nunca conta, por mais perto que o contorno esteja", () => {
  const balloon = container({ bbox: { x0: 100, y0: 100, x1: 300, y1: 240 } });
  // Centre at x=310, past the box's own x1=300 - the coarse box gate rejects it outright,
  // the way it always has, regardless of the contour slack above.
  const neighbour = { bbox: { x0: 305, y0: 150, x1: 315, y1: 170 } };
  assert.equal(comicSeedBelongsToContainer(neighbour, balloon), false);
});

test("sem contorno (um documento antigo), a própria caixa do balão basta", () => {
  const balloon = container({ bbox: { x0: 100, y0: 100, x1: 300, y1: 240 }, contour: [] });
  const word = { bbox: { x0: 170, y0: 150, x1: 230, y1: 170 } };
  assert.ok(comicSeedBelongsToContainer(word, balloon));
});
