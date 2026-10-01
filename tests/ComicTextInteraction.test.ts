import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ComicHitMap, COMIC_HIT_SLOP_PX, COMIC_SMALL_BALLOON_SLOP_PX, type ComicPageArt } from "../src/reader/comic/interaction/ComicHitMap";
import { ComicInteractionEngine } from "../src/reader/comic/interaction/ComicInteractionEngine";
import { comicBubbleTarget, comicBubbleText, comicBubbleZoom, COMIC_BUBBLE_ZOOM } from "../src/reader/comic/interaction/ComicBubbleLayout";
import { comicBubbleFallbackPath, comicBubblePath } from "../src/reader/comic/interaction/ComicBubbleShape";
import { ComicBubbleView } from "../src/reader/comic/interaction/ComicBubbleView";
import { COMIC_TURN } from "../src/reader/comic/ComicTurnController";
import { ComicHintPolicy, COMIC_HINT } from "../src/reader/comic/interaction/ComicHintAnimator";
import { comicReadingOrder, comicReadingSequence } from "../src/reader/comic/interaction/ComicReadingOrder";
import type { ComicDocument, ComicTextRegion } from "../src/reader/comic/interaction/ComicInteractionTypes";

const source = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const region = (id: string, pageIndex: number, bounds: [number, number, number, number], over: Partial<ComicTextRegion> = {}): ComicTextRegion => ({
  id, pageIndex, text: `texto ${id}`, shape: "balloon", tailDirection: "down", type: "speech",
  x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3], ...over,
});

function engineWith(...regions: ComicTextRegion[]): ComicInteractionEngine {
  const pages = [0, 1].map(index => ({ index, id: `page-${index}`, imagePath: `pages/${index}.webp`, mimeType: "image/webp" as const, cover: index === 0, regions: regions.filter(value => value.pageIndex === index) }));
  const engine = new ComicInteractionEngine();
  engine.open({ manifest: {} as ComicDocument["manifest"], metadata: {} as ComicDocument["metadata"], pages });
  return engine;
}

describe("HQ: o mapa de regiões acompanha a página, não a tela", () => {
  const art = { x: 200, y: 60, width: 400, height: 600 };
  const pages: ComicPageArt[] = [{ pageIndex: 0, rect: art }];

  it("o ponto é lido em relação ao retângulo da arte, com margem ao redor", () => {
    const map = new ComicHitMap(pages, engineWith(region("r1", 0, [.25, .5, .2, .1])));
    // Centre of the region: 200 + .35*400 = 340, 60 + .55*600 = 390.
    assert.equal(map.hit({ x: 340, y: 390 })?.region.id, "r1");
    assert.deepEqual(map.locate({ x: 200, y: 60 }), { pageIndex: 0, x: 0, y: 0 });
    assert.equal(map.locate({ x: 199 - COMIC_HIT_SLOP_PX, y: 360 }), null);
    assert.equal(map.hit({ x: 340, y: 100 }), null);
  });

  it("a mesma região é atingida em qualquer escala ou posição da página", () => {
    const small = new ComicHitMap([{ pageIndex: 0, rect: { x: 0, y: 140, width: 412, height: 618 } }], engineWith(region("r1", 0, [.25, .5, .2, .1])));
    assert.equal(small.hit({ x: 0 + .35 * 412, y: 140 + .55 * 618 })?.region.id, "r1");
    const rect = ComicHitMap.regionRect({ x: 0, y: 140, width: 412, height: 618 }, { x: .25, y: .5, width: .2, height: .1 });
    assert.deepEqual(rect, { x: 103, y: 449, width: 82.4, height: 61.800000000000004 });
  });

  it("no livro aberto cada página usa as suas próprias regiões", () => {
    const left = { x: 100, y: 50, width: 300, height: 450 }, right = { x: 400, y: 50, width: 300, height: 450 };
    const map = new ComicHitMap([{ pageIndex: 2, rect: left }, { pageIndex: 3, rect: right }],
      engineWith(region("esq", 0, [.1, .1, .3, .3]), region("dir", 1, [.1, .1, .3, .3])));
    const engine = engineWith();
    assert.equal(new ComicHitMap([], engine).hit({ x: 1, y: 1 }), null);
    // Page indexes come from the pages on screen, so a point on the right page can never
    // answer with the left page's regions.
    assert.equal(map.locate({ x: 150, y: 100 })?.pageIndex, 2);
    assert.equal(map.locate({ x: 450, y: 100 })?.pageIndex, 3);
  });

  it("regiões sobrepostas resolvem para a mais próxima do toque", () => {
    const map = new ComicHitMap(pages, engineWith(region("grande", 0, [.1, .1, .8, .8]), region("pequena", 0, [.6, .6, .2, .2])));
    assert.equal(map.hit({ x: 200 + .7 * 400, y: 60 + .7 * 600 })?.region.id, "pequena");
    assert.equal(map.hit({ x: 200 + .2 * 400, y: 60 + .2 * 600 })?.region.id, "grande");
  });
});

describe("HQ: o asset original é ampliado sem distorcer ou reescrever sua arte", () => {
  const viewport = { width: 412, height: 915 };
  const lettered = (capHeight: number, visual: { x: number; y: number; width: number; height: number }): ComicTextRegion =>
    region("r", 0, [visual.x, visual.y, visual.width, visual.height], {
      visualBounds: visual, textBounds: { x: visual.x + .01, y: visual.y + .01, width: visual.width - .02, height: visual.height - .02 },
      typography: { family: "comic", weight: "normal", italic: false, align: "center", capHeight, lines: 2 },
    });

  it("a ampliação vem do tamanho das letras, não de um fator fixo", () => {
    // A caption in the corner of a panel: tiny on screen, and tiny lettering inside it.
    const small = comicBubbleZoom({ x: 40, y: 400, width: 34, height: 15 }, viewport, true,
      lettered(.004, { x: .1, y: .4, width: .09, height: .02 }));
    // A balloon that already fills a third of the page, lettered to match.
    const large = comicBubbleZoom({ x: 20, y: 200, width: 330, height: 220 }, viewport, true,
      lettered(.02, { x: .05, y: .2, width: .85, height: .3 }));
    assert.ok(small > 4, `uma caixa pequena deveria crescer bastante, cresceu ${small}`);
    assert.ok(large < 2.6, `um balão grande deveria crescer pouco, cresceu ${large}`);
    assert.ok(small <= COMIC_BUBBLE_ZOOM.max && large >= COMIC_BUBBLE_ZOOM.min);
  });

  it("a forma não é distorcida: um único fator nos dois lados", () => {
    const source = { x: 120, y: 300, width: 90, height: 40 };
    const target = comicBubbleTarget({ source, viewport, compact: true, region: lettered(.006, { x: .3, y: .3, width: .2, height: .05 }) });
    assert.ok(Math.abs(target.width / source.width - target.height / source.height) < 1e-9);
    assert.ok(target.zoom > 1);
  });

  it("qualquer origem termina dentro da tela, com margem", () => {
    for (const source of [{ x: 0, y: 0, width: 20, height: 14 }, { x: 392, y: 900, width: 20, height: 14 },
      { x: 10, y: 450, width: 390, height: 300 }, { x: 200, y: 450, width: 40, height: 30 }]) {
      const target = comicBubbleTarget({ source, viewport, compact: true, region: lettered(.003, { x: .1, y: .1, width: .2, height: .06 }) });
      assert.ok(target.x >= 0 && target.y >= 0, JSON.stringify(target));
      assert.ok(target.x + target.width <= viewport.width + 1e-9 && target.y + target.height <= viewport.height + 1e-9, JSON.stringify(target));
    }
  });

  it("o texto é o reconhecido: reflui, mas nada é corrigido nem inventado", () => {
    assert.equal(comicBubbleText("NÃO PODEM\nFUGIR DE MIM"), "NÃO PODEM FUGIR DE MIM");
    assert.equal(comicBubbleText("PERGUN-\nTEI ALGO"), "PERGUN-TEI ALGO");
    assert.equal(comicBubbleText("PRIMEIRO\n\nSEGUNDO"), "PRIMEIRO\n\nSEGUNDO");
    assert.equal(comicBubbleText("  COVtRDE  "), "COVtRDE");
  });

  it("o balão parte exatamente do retângulo da região", () => {
    const transform = ComicBubbleView.transformFrom({ x: 120, y: 200, width: 40, height: 20 }, { x: 100, y: 150, width: 200, height: 100 });
    assert.equal(transform, "translate(20px, 50px) scale(0.2)");
  });

  it("contornos antigos continuam legíveis, mas a ampliação usa a arte original", () => {
    const visual = { x: .2, y: .1, width: .2, height: .1 };
    const contour = [{ x: .2, y: .1 }, { x: .4, y: .1 }, { x: .4, y: .2 }, { x: .2, y: .2 }];
    // The outline arrives normalized to the page and is placed inside the balloon's own box.
    const path = comicBubblePath(contour, visual, "rectangle");
    assert.equal(path, "M 0 0 L 100 0 L 100 100 L 0 100 Z");
    // A balloon is drawn through its points with curves, so the sampling grid never shows.
    const oval = comicBubblePath([{ x: .2, y: .1 }, { x: .3, y: .1 }, { x: .4, y: .15 }, { x: .35, y: .2 }, { x: .25, y: .2 }, { x: .2, y: .15 }], visual, "balloon");
    assert.match(oval, /^M .* C .* Z$/);
    // An older package with no outline gets a clean container, never an invented shape.
    assert.match(comicBubbleFallbackPath("balloon"), /^M 50 1 C/);
    assert.equal(comicBubbleFallbackPath("rectangle"), "M 1 1 L 99 1 L 99 99 L 1 99 Z");

    const view = source("reader/comic/interaction/ComicBubbleView.ts");
    assert.match(view, /comicArtworkCanvas\(art\)/);
    assert.doesNotMatch(view, /paragraph\.textContent|createElementNS|fillText|comicBubbleFallbackPath/);
  });
});

describe("HQ: quem recebe o gesto", () => {
  it("um clique parado é da camada de texto, e nunca vira a página", () => {
    const controller = source("reader/comic/ComicTurnController.ts");
    assert.match(controller, /if \(still && !hotspot && duration < COMIC_TURN\.regionTapMs\) this\.host\.tap\?\.\(this\.local\(event\), duration\);/);
    // Only a still press: a swipe never opens a balloon.
    assert.match(controller, /if \(state !== "DRAGGING" \|\| !this\.drag\) return;/);
    // No corner, edge or half of the spread turns on a click any more: on the open book
    // the balloon under the pointer was unreachable because the page moved first.
    assert.doesNotMatch(controller, /tapSide|COMIC_TURN\.tapMs/);
    assert.ok(COMIC_TURN.regionTapMs >= 350);
  });

  it("uma tremida do dedo não é um arrasto, e um peteleco precisa ter andado", () => {
    assert.ok(COMIC_TURN.slop >= 12);
    assert.ok(COMIC_TURN.flickMinPx >= 20);
    assert.match(source("reader/comic/ComicTurnController.ts"), /fling > COMIC_TURN\.flick && turned > \.02 && travelled >= COMIC_TURN\.flickMinPx/);
  });

  it("um balão aberto é dono dos gestos dentro dele", () => {
    assert.match(source("reader/comic/ComicTurnController.ts"), /\.comic-block, \.comic-fab, \.comic-arrow, \.comic-overlay--open, \.comic-bubble/);
  });

  it("virar a página fecha o balão antes e recarrega o mapa depois", () => {
    const view = source("views/ComicReaderView.ts");
    assert.match(view, /if \(active\) \{ this\.overlay\.close\(\); this\.bubble\?\.closeNow\(\); this\.hints\?\.interrupt\(\); \}/);
    assert.match(view, /this\.hitLayer\?\.classList\.toggle\("comic-hitmap--hidden", active\)/);
    // Arriving on a new position redraws, and the redraw rebuilds the hit map.
    assert.match(view, /private arrived\(save: boolean\): void \{\s*this\.overlay\.clear\(\);\s*this\.bubble\?\.closeNow\(\);/);
    assert.match(view, /this\.placeOverlay\(\);\s*this\.placeHitMap\(\);/);
  });

  it("o motor de livros e a física da virada de HQ não foram tocados", () => {
    const engine = source("reader/comic/ComicTurnController.ts");
    // The leaf still settles on the same distance and velocity rules.
    assert.match(engine, /threshold: \.32/);
    assert.match(engine, /flick: \.35/);
    assert.match(engine, /settleMinMs: 170, settleSpanMs: 480/);
    for (const file of ["views/ComicReaderView.ts", "reader/comic/interaction/ComicBubbleView.ts", "reader/comic/interaction/ComicHitMap.ts", "reader/comic/interaction/ComicBubbleLayout.ts"]) {
      assert.doesNotMatch(source(file), /page-turn\/|reader\/desktop\/|reflow\/|PageTurnEngine|FlexiblePageCurl/, file);
    }
  });
});

describe("HQ: reconhecimento incerto e depuração", () => {
  it("a região incerta é marcada no elemento, sem mensagem técnica ao leitor", () => {
    const bubble = source("reader/comic/interaction/ComicBubbleView.ts");
    assert.match(bubble, /element\.dataset\.review = region\.recognitionStatus \?\? "needs-review";/);
    // Recognition confidence steers nothing the reader can see: no label, no message.
    assert.doesNotMatch(bubble, /ocrConfidence|textContent = .*confian/i);
    const view = source("views/ComicReaderView.ts");
    assert.match(view, /target\.dataset\.review = region\.recognitionStatus \?\? "recognized";/);
  });

  it("os contornos das regiões só aparecem com a depuração ligada, desligada por padrão", () => {
    const view = source("views/ComicReaderView.ts");
    assert.match(view, /localStorage\.getItem\("lumeo\.comic\.debug"\) === "1" \|\| new URLSearchParams\(location\.search\)\.get\("comicDebug"\) === "1"/);
    const css = readFileSync(new URL("../src/styles/comic.css", import.meta.url), "utf8");
    assert.match(css, /\.comic-hitmap--debug \.comic-hitmap__target \{[^}]*outline/);
    assert.match(css, /\.comic-hitmap__target \{[^}]*pointer-events: none/);
  });
});

describe("HQ: a dica de que o balão é tocável", () => {
  const target = (id: string, over: Partial<ComicTextRegion> = {}, rect = { x: 40, y: 60, width: 120, height: 70 }) =>
    ({ region: region(id, 0, [.1, .1, .2, .1], over), rect });

  it("a dica segue a ordem de leitura e nunca repete uma região", () => {
    const policy = new ComicHintPolicy();
    const targets = [target("b", { readingOrder: 2 }), target("a", { readingOrder: 1 }), target("c", { readingOrder: 3 })];
    const first = policy.pick(targets)!;
    assert.equal(first.region.id, "a");
    policy.noteShown(first.region);
    // Ignored: the next nudge moves on instead of insisting on the same balloon.
    const second = policy.pick(targets)!;
    assert.equal(second.region.id, "b");
    policy.noteShown(second.region);
    assert.equal(policy.pick(targets)?.region.id, "c");
  });

  it("quem abre direto a terceira região não é mandado de volta para a primeira", () => {
    const policy = new ComicHintPolicy();
    const targets = [target("a", { readingOrder: 1 }), target("b", { readingOrder: 2 }), target("c", { readingOrder: 3 }), target("d", { readingOrder: 4 })];
    policy.noteOpened(targets[2]!.region);
    assert.equal(policy.pick(targets)?.region.id, "d");
    policy.noteShown(targets[3]!.region);
    assert.equal(policy.pick(targets), null, "não voltar às regiões anteriores depois da última");
  });

  it("uma página nova recomeça no primeiro balão dela", () => {
    const policy = new ComicHintPolicy();
    const targets = [target("a", { readingOrder: 1 }), target("b", { readingOrder: 2 })];
    policy.noteShown(targets[1]!.region);
    policy.reset();
    assert.equal(policy.pick(targets)?.region.id, "a");
  });

  it("passa por cima do que é pequeno demais para se ver mexer", () => {
    const policy = new ComicHintPolicy();
    const tiny = { x: 0, y: 0, width: COMIC_HINT.minWidthPx - 4, height: COMIC_HINT.minHeightPx - 3 };
    assert.equal(policy.pick([target("minúscula", { readingOrder: 1 }, tiny)]), null);
    const mixed = [target("minúscula", { readingOrder: 1 }, tiny), target("visível", { readingOrder: 2 })];
    assert.equal(policy.pick(mixed)?.region.id, "visível");
    // A phone in landscape shrinks a whole page into 336px: its balloons still qualify.
    assert.ok(policy.pick([target("paisagem", { readingOrder: 1 }, { x: 10, y: 10, width: 20, height: 14 })]));
  });

  it("para quando o leitor mostra que entendeu, e quando já apareceu algumas vezes", () => {
    const learned = new ComicHintPolicy();
    for (let open = 0; open < COMIC_HINT.learnedAfterOpens; open++) learned.noteOpened();
    assert.equal(learned.finished, true);
    const tired = new ComicHintPolicy();
    for (let shown = 0; shown < COMIC_HINT.maxPerSession; shown++) tired.noteShown(region(`r${shown}`, 0, [.1, .1, .2, .1], { readingOrder: shown + 1 }));
    assert.equal(tired.finished, true);
    assert.equal(new ComicHintPolicy(() => true).finished, true, "prefers-reduced-motion");
  });

  it("é discreta: cresce poucos por cento, some sozinha e sai na frente de qualquer gesto", () => {
    assert.ok(COMIC_HINT.growth > 1 && COMIC_HINT.growth <= 1.08);
    assert.ok(COMIC_HINT.firstDelayMs >= 5000 && COMIC_HINT.repeatMs >= COMIC_HINT.firstDelayMs);
    const animator = source("reader/comic/interaction/ComicHintAnimator.ts");
    // Never over a turn, never with a balloon open, never twice at once.
    assert.match(animator, /if \(this\.destroyed \|\| this\.finished \|\| this\.playing\) return;/);
    assert.match(animator, /if \(!this\.options\.idle\(\)\) \{ this\.schedule\(COMIC_HINT\.repeatMs\); return; \}/);
    // What moves is the artist's own balloon, cut to the outline the .lima knows: the page
    // itself, with nothing of the panel, the fire or the balloon next door coming along.
    assert.match(animator, /comicArtworkCanvas\(art\)/);
    assert.doesNotMatch(animator, /fillText|comicBubbleFallbackPath|devicePixelRatio/);
    // The only thing it styles is where the copy sits: no decoration is ever added.
    assert.doesNotMatch(animator, /style\.(border|outline|boxShadow|background)/);
    assert.equal(animator.match(/Object\.assign\(element\.style/g)?.length, 1);
    const css = readFileSync(new URL("../src/styles/comic.css", import.meta.url), "utf8");
    // It is the balloon, so it carries no decoration of its own - not even the lift the
    // enlarged balloon gets, which would give it away as something new on the page.
    assert.match(css, /\.comic-hint \{ position: absolute; pointer-events: none;[^}]*filter: none;/);
    assert.doesNotMatch(css, /\.comic-hint \{[^}]*(border|outline|box-shadow)/);
    const view = source("views/ComicReaderView.ts");
    assert.match(view, /idle: \(\) => !this\.disposed && this\.bubble\?\.isOpen !== true && this\.controller\?\.state === "IDLE"/);
    assert.match(view, /this\.stage\.addEventListener\("pointerdown", this\.handlePointerDown, \{ capture: true, passive: true \}\)/);
    assert.match(view, /private readonly handlePointerDown = \(\): void => \{ this\.hints\?\.interrupt\(\); \};/);
  });
});

describe("HQ: a ordem provável de leitura da página", () => {
  const at = (id: string, x: number, y: number, width = .2, height = .08): ComicTextRegion =>
    region(id, 0, [x, y, width, height], { visualBounds: { x, y, width, height } });

  it("lê cada faixa da esquerda para a direita, de cima para baixo", () => {
    // Two balloons side by side at the top, one below, one at the foot of the page.
    const ordered = comicReadingOrder([at("baixo", .1, .8), at("direita", .6, .1), at("esquerda", .1, .12), at("meio", .3, .45)]);
    assert.deepEqual(ordered.sort((a, b) => a.readingOrder! - b.readingOrder!).map(value => value.id),
      ["esquerda", "direita", "meio", "baixo"]);
    assert.deepEqual(ordered.map(value => value.readingOrder), [1, 2, 3, 4]);
  });

  it("dois balões na mesma altura ficam na mesma faixa mesmo com alturas diferentes", () => {
    const ordered = comicReadingOrder([at("alto", .55, .1, .2, .3), at("curto", .15, .18, .2, .06)]);
    const first = ordered.find(value => value.id === "curto")!, second = ordered.find(value => value.id === "alto")!;
    assert.equal(first.readingOrder, 1); assert.equal(second.readingOrder, 2);
  });

  it("mangá é lido da direita para a esquerda", () => {
    const ordered = comicReadingOrder([at("esquerda", .1, .1), at("direita", .6, .12)], "rtl");
    assert.equal(ordered.find(value => value.id === "direita")?.readingOrder, 1);
    assert.equal(ordered.find(value => value.id === "esquerda")?.readingOrder, 2);
  });

  it("uma ordem corrigida à mão é respeitada, e quem não tem ordem entra depois", () => {
    const manual = [{ ...at("segundo", .1, .1), readingOrder: 2 }, { ...at("primeiro", .6, .5), readingOrder: 1 }, at("sem-ordem", .2, .3)];
    assert.deepEqual(comicReadingSequence(manual).map(value => value.id), ["primeiro", "segundo", "sem-ordem"]);
  });
});

/** The case from the page the reader reported: a balloon drawn as two lobes that really do
 *  run into each other, and a third, separate balloon lying inside the rectangle around
 *  them. Proximity is not belonging, and the outline is what says so. */
const lobes = (): ComicTextRegion => region("grupo", 0, [.30, .30, .40, .30], {
  visualBounds: { x: .30, y: .30, width: .40, height: .30 },
  hitBounds: { x: .30, y: .30, width: .40, height: .30 },
  segmentationMethod: "component-mask",
  // Two lobes joined at the waist, with nothing of the corner where the third balloon is.
  contour: [{ x: .30, y: .30 }, { x: .52, y: .30 }, { x: .52, y: .40 }, { x: .70, y: .40 },
    { x: .70, y: .60 }, { x: .48, y: .60 }, { x: .48, y: .46 }, { x: .30, y: .46 }],
});

const neighbour = (): ComicTextRegion => region("vizinho", 0, [.56, .30, .12, .08], {
  visualBounds: { x: .56, y: .30, width: .12, height: .08 },
  hitBounds: { x: .56, y: .30, width: .12, height: .08 },
  segmentationMethod: "component-mask",
  contour: [{ x: .56, y: .30 }, { x: .68, y: .30 }, { x: .68, y: .38 }, { x: .56, y: .38 }],
});

describe("HQ: o toque pertence à silhueta, não ao retângulo", () => {
  const art = { x: 0, y: 0, width: 1000, height: 1000 };
  const pages: ComicPageArt[] = [{ pageIndex: 0, rect: art }];
  const map = (): ComicHitMap => new ComicHitMap(pages, engineWith(lobes(), neighbour()));

  it("o balão independente dentro do retângulo do grupo recebe o próprio toque", () => {
    // (620, 340) is inside the group's bounding box and inside the neighbour's outline.
    assert.equal(map().hit({ x: 620, y: 340 })?.region.id, "vizinho");
  });

  it("cada lóbulo do grupo abre o grupo", () => {
    assert.equal(map().hit({ x: 400, y: 380 })?.region.id, "grupo");
    assert.equal(map().hit({ x: 600, y: 500 })?.region.id, "grupo");
  });

  it("o vão entre os lóbulos, dentro do retângulo mas fora da silhueta, não é do grupo", () => {
    // (340, 560) is inside the group's bounding box and outside its outline: the empty
    // page under the upper lobe. Nothing opens there, and an open balloon closes.
    assert.equal(map().hit({ x: 340, y: 560 }), null);
  });

  it("a tolerância é de poucos pixels, não de uma auréola", () => {
    assert.ok(COMIC_HIT_SLOP_PX <= 8);
    // Just outside the neighbour's outline, and outside the group's box: still nothing.
    assert.equal(map().hit({ x: 690, y: 290 }), null);
  });

  it("sem contorno, o menor retângulo que contém o ponto ganha", () => {
    const big = region("grande", 0, [.2, .2, .6, .6], { hitBounds: { x: .2, y: .2, width: .6, height: .6 } });
    const small = region("pequeno", 0, [.45, .45, .1, .1], { hitBounds: { x: .45, y: .45, width: .1, height: .1 } });
    const overlapping = new ComicHitMap(pages, engineWith(big, small));
    assert.equal(overlapping.hit({ x: 500, y: 500 })?.region.id, "pequeno");
    assert.equal(overlapping.hit({ x: 300, y: 300 })?.region.id, "grande");
  });

  it("a silhueta vence o retângulo de outro, mesmo o do balão já aberto", () => {
    // Order matters only if the rule is "first wins": the group is written first here.
    const swapped = new ComicHitMap(pages, engineWith(neighbour(), lobes()));
    assert.equal(swapped.hit({ x: 620, y: 340 })?.region.id, "vizinho");
    assert.equal(map().hit({ x: 620, y: 340 })?.region.id, "vizinho");
  });
});

describe("HQ: a conversa em grupo tem um halo próprio, maior que o de um balão", () => {
  const art = { x: 0, y: 0, width: 1000, height: 1000 };
  const pages: ComicPageArt[] = [{ pageIndex: 0, rect: art }];
  const conversationGroup: ComicTextRegion["bubbleGroup"] = { id: "g1", unionBounds: { x: .4, y: .4, width: .2, height: .1 },
    members: [{ id: "g1-m1", bounds: { x: .4, y: .4, width: .1, height: .1 } }, { id: "g1-m2", bounds: { x: .5, y: .4, width: .1, height: .1 } }] };
  const grupo = (): ComicTextRegion => region("grupo", 0, [.40, .40, .20, .10], {
    visualBounds: { x: .40, y: .40, width: .20, height: .10 }, hitBounds: { x: .40, y: .40, width: .20, height: .10 },
    segmentationMethod: "component-mask", bubbleGroup: conversationGroup,
    contour: [{ x: .40, y: .40 }, { x: .60, y: .40 }, { x: .60, y: .50 }, { x: .40, y: .50 }],
  });
  // An independent caption nearby, its own edge 15px past the group's own - close enough
  // to sit beside it on the page - and no bubbleGroup of its own: it must never be
  // shadowed by the group's halo, on a tap that lands on the caption itself.
  const legenda = (): ComicTextRegion => region("legenda", 0, [.615, .40, .10, .10], {
    visualBounds: { x: .615, y: .40, width: .10, height: .10 }, hitBounds: { x: .615, y: .40, width: .10, height: .10 },
  });
  const map = (): ComicHitMap => new ComicHitMap(pages, engineWith(grupo(), legenda()));

  it("tocar dentro do grupo continua abrindo o grupo, sem mudança", () => {
    assert.equal(map().hit({ x: 500, y: 450 })?.region.id, "grupo");
  });

  it("tocar no vão vazio a poucos pixels do grupo, além do halo normal de um balão, ainda abre o grupo", () => {
    // 8px past the group's own edge (600), and short of the caption at 615: outside
    // COMIC_HIT_SLOP_PX (6) but inside the group's own COMIC_GROUP_HIT_SLOP_PX (10).
    assert.ok(COMIC_HIT_SLOP_PX < 8);
    assert.equal(map().hit({ x: 608, y: 450 })?.region.id, "grupo");
  });

  it("um objeto independente perto do grupo responde por si, nunca é engolido pelo halo", () => {
    // Squarely inside the caption's own rectangle: its real hit must win outright, no
    // matter how close it sits to the group.
    assert.equal(map().hit({ x: 640, y: 450 })?.region.id, "legenda");
  });

  it("fora do halo do grupo, nada abre - o Reader segue seu comportamento normal", () => {
    assert.equal(map().hit({ x: 500, y: 900 }), null);
    // Just past the 10px halo itself.
    assert.equal(map().hit({ x: 500, y: 388 }), null);
  });

  it("um balão isolado, sem bubbleGroup, não ganha o halo maior", () => {
    const isolated = region("solo", 0, [.10, .10, .10, .10], {
      visualBounds: { x: .10, y: .10, width: .10, height: .10 }, hitBounds: { x: .10, y: .10, width: .10, height: .10 },
      contour: [{ x: .10, y: .10 }, { x: .20, y: .10 }, { x: .20, y: .20 }, { x: .10, y: .20 }],
    });
    const solo = new ComicHitMap(pages, engineWith(isolated));
    // 8px past its edge (200): inside 10px but this region carries no bubbleGroup.
    assert.equal(solo.hit({ x: 208, y: 150 }), null);
  });
});

describe("HQ: um balão pequeno ganha uma área de toque maior que a área visual", () => {
  // 1000x1000 art: a region's normalized bounds land on screen pixels one-to-one, so the
  // math below reads directly as "px past the edge".
  const art = { x: 0, y: 0, width: 1000, height: 1000 };
  const pages: ComicPageArt[] = [{ pageIndex: 0, rect: art }];

  it("um balão menor que o alvo confortável (44px) estica sua tolerância de toque até o teto, sem mudar de tamanho na tela", () => {
    // 20x20px on screen: well under the 44px comfortable target, so its slop widens past
    // the flat COMIC_HIT_SLOP_PX, up to the COMIC_SMALL_BALLOON_SLOP_PX ceiling (16px).
    const small = region("pequeno", 0, [.400, .400, .020, .020], { shape: "caption", type: "caption" });
    const map = new ComicHitMap(pages, engineWith(small));
    assert.ok(COMIC_SMALL_BALLOON_SLOP_PX > COMIC_HIT_SLOP_PX, "o teto do pequeno precisa ser maior que a tolerância padrão, ou a correção não faz nada");
    // 14px past the right edge (420): inside the widened slop.
    assert.equal(map.hit({ x: 434, y: 410 })?.region.id, "pequeno");
    // 20px past: outside even the widened ceiling.
    assert.equal(map.hit({ x: 440, y: 410 }), null);
    // The drawn, enlargeable region itself never grows - only how close a touch must land.
    const hit = map.hit({ x: 410, y: 410 });
    assert.deepEqual(hit?.source, { x: 400, y: 400, width: 20, height: 20 });
  });

  it("um balão com área visual confortável (>=44px) mantém a tolerância padrão, sem halo extra", () => {
    const big = region("grande", 0, [.100, .100, .060, .060], { shape: "caption", type: "caption" });
    const map = new ComicHitMap(pages, engineWith(big));
    // 5px past the edge (160): inside the flat COMIC_HIT_SLOP_PX (6).
    assert.equal(map.hit({ x: 165, y: 130 })?.region.id, "grande");
    // 7px past: outside it - unchanged from before this fix, so a big balloon's neighbours
    // are never put at risk by the small-balloon widening.
    assert.equal(map.hit({ x: 167, y: 130 }), null);
  });

  it("um balão minúsculo, abaixo do teto inteiro, ainda assim não ultrapassa o teto de widening", () => {
    // 4x4px: tiny enough that the raw formula would ask for more slop than the ceiling allows.
    const tiny = region("minusculo", 0, [.500, .500, .004, .004], { shape: "caption", type: "caption" });
    const map = new ComicHitMap(pages, engineWith(tiny));
    // 15px past the edge (504): inside the 16px ceiling.
    assert.equal(map.hit({ x: 519, y: 502 })?.region.id, "minusculo");
    // 17px past: outside the ceiling, even for a balloon this small.
    assert.equal(map.hit({ x: 521, y: 502 }), null);
  });

  it("dois balões pequenos vizinhos continuam respondendo cada um por si, sem um alcançar o toque do outro", () => {
    const left = region("esquerda", 0, [.300, .500, .020, .020], { shape: "caption", type: "caption" });
    const right = region("direita", 0, [.360, .500, .020, .020], { shape: "caption", type: "caption" });
    const map = new ComicHitMap(pages, engineWith(left, right));
    // left spans 300-320, right spans 360-380: a 40px gap, comfortably wider than twice the
    // 16px ceiling, so a touch anywhere in the gap resolves to whichever edge is nearest.
    assert.equal(map.hit({ x: 330, y: 510 })?.region.id, "esquerda");
    assert.equal(map.hit({ x: 350, y: 510 })?.region.id, "direita");
  });
});

describe("HQ: o balão ampliado não esconde os outros", () => {
  const viewport = { width: 1400, height: 900 };
  const source = { x: 500, y: 300, width: 200, height: 120 };

  it("sem obstáculos, ele cresce onde está", () => {
    const target = comicBubbleTarget({ source, viewport, compact: false });
    const free = comicBubbleTarget({ source, viewport, compact: false, obstacles: [] });
    assert.deepEqual([target.x, target.y], [free.x, free.y]);
  });

  it("um balão clicável logo abaixo não é coberto por inteiro", () => {
    const obstacle = { x: 540, y: 470, width: 120, height: 90 };
    const target = comicBubbleTarget({ source, viewport, compact: false, obstacles: [obstacle] });
    const overlapWidth = Math.max(0, Math.min(target.x + target.width, obstacle.x + obstacle.width) - Math.max(target.x, obstacle.x));
    const overlapHeight = Math.max(0, Math.min(target.y + target.height, obstacle.y + obstacle.height) - Math.max(target.y, obstacle.y));
    const covered = (overlapWidth * overlapHeight) / (obstacle.width * obstacle.height);
    assert.ok(covered < .9, `o vizinho ficou ${Math.round(covered * 100)}% coberto`);
  });

  it("nenhum lado é preferido: o obstáculo muda de lado e a escolha acompanha", () => {
    // Obstacles that really are in the way of the natural placement, one on each side.
    const left = comicBubbleTarget({ source, viewport, compact: false, obstacles: [{ x: 380, y: 280, width: 200, height: 200 }] });
    const right = comicBubbleTarget({ source, viewport, compact: false, obstacles: [{ x: 620, y: 280, width: 200, height: 200 }] });
    assert.ok(left.x > right.x, "fugiu do obstáculo à esquerda para a direita, e vice-versa");
  });

  it("o resultado continua dentro da tela", () => {
    const target = comicBubbleTarget({ source, viewport, compact: false, obstacles: [{ x: 0, y: 0, width: 1400, height: 900 }] });
    assert.ok(target.x >= 0 && target.y >= 0);
    assert.ok(target.x + target.width <= viewport.width && target.y + target.height <= viewport.height);
  });
});

describe("HQ: leitura no desktop", () => {
  it("a letra no desktop é cerca do dobro da de antes, e o celular não muda", () => {
    assert.equal(COMIC_BUBBLE_ZOOM.capHeightPx.compact, 15, "o tamanho validado no celular fica como está");
    assert.ok(COMIC_BUBBLE_ZOOM.capHeightPx.wide >= 32, "o desktop dobrou os dezessete pixels de antes");
    const source = { x: 400, y: 300, width: 180, height: 110 };
    const viewport = { width: 1600, height: 1000 };
    const small = region("r", 0, [.3, .3, .12, .05], { typography: { capHeight: .006, lines: 2 } as ComicTextRegion["typography"],
      visualBounds: { x: .3, y: .3, width: .12, height: .05 }, text: "UMA FALA\nCURTA" });
    const zoom = comicBubbleZoom(source, viewport, false, small);
    assert.ok(zoom > 2, `o balão pequeno cresce de verdade no desktop (${zoom.toFixed(2)}x)`);
  });

  it("o teto da tela ainda manda: nada sai da janela", () => {
    const source = { x: 40, y: 40, width: 900, height: 600 };
    const viewport = { width: 1000, height: 700 };
    const target = comicBubbleTarget({ source, viewport, compact: false, region: region("r", 0, [.05, .05, .9, .8]) });
    assert.ok(target.width <= viewport.width && target.height <= viewport.height);
  });
});

describe("HQ: mesmo coberto, o vizinho continua clicável", () => {
  it("a arte original usa sua máscara completa sem um segundo recorte simplificado", () => {
    const view = source("reader/comic/interaction/ComicBubbleView.ts");
    assert.match(view, /comicArtworkCanvas\(art\)/);
    assert.doesNotMatch(view, /element\.style\.clipPath\s*=/);
  });

  it("um clique sobre o ampliado é respondido pela página embaixo dele, e um canto transparente fecha", () => {
    const reader = source("views/ComicReaderView.ts");
    assert.match(reader, /handleBubbleClick/);
    assert.match(reader, /if \(now - bubble\.openedAt < COMIC_BUBBLE_MOTION\.openMs\) return;/,
      "o clique tardio do próprio toque que abriu não troca de balão");
    assert.match(reader, /if \(hit\?\.region\.id === bubble\.activeRegion\?\.id\) return;/,
      "um clique no próprio balão aberto não faz nada");
    assert.match(reader, /if \(hit\) \{ void bubble\.open\(hit\.region, hit\.source\); this\.hints\?\.noteOpened\(hit\.region\); \}\s*\n\s*else bubble\.close\(\);/,
      "sem nada por baixo - o canto transparente do recorte - o balão fecha em vez de ficar mudo");
  });

  it("o vizinho colado pesa mais que um balão distante na escolha do lugar", () => {
    const viewport = { width: 900, height: 900 };
    const source2 = { x: 300, y: 300, width: 160, height: 120 };
    const perto = { x: 470, y: 300, width: 90, height: 70 };
    const longe = { x: 60, y: 780, width: 90, height: 70 };
    const target = comicBubbleTarget({ source: source2, viewport, compact: false, obstacles: [perto, longe] });
    const overlap = (rect: { x: number; y: number; width: number; height: number }): number => {
      const w = Math.max(0, Math.min(target.x + target.width, rect.x + rect.width) - Math.max(target.x, rect.x));
      const h = Math.max(0, Math.min(target.y + target.height, rect.y + rect.height) - Math.max(target.y, rect.y));
      return (w * h) / (rect.width * rect.height);
    };
    assert.ok(overlap(perto) < .9, "o balão ao lado não desaparece embaixo do ampliado");
  });
});

describe("HQ: preparação da página e o que ela não muda", () => {
  it("um toque fora fecha, e um toque em outro balão troca sem fechar antes", () => {
    const view = source("views/ComicReaderView.ts");
    assert.match(view, /if \(hit && hit\.region\.id !== bubble\.activeRegion\?\.id\) \{ bubble\.open\(hit\.region, hit\.source\); this\.hints\?\.noteOpened\(hit\.region\); \}\s*\n\s*else bubble\.close\(\);/);
  });

  it("o indicador é da página, pequeno e sem bloquear nada", () => {
    const view = source("views/ComicReaderView.ts");
    assert.match(view, /private placePreparing\(\)/);
    assert.match(view, /reader\.comic\.preparingPercent/);
    // The badge only exists while that page has no interaction of its own.
    assert.match(view, /!this\.interaction\.page\(art\.pageIndex\) \|\| this\.preparationSettling\.has\(art\.pageIndex\)/);
    const css = readFileSync(new URL("../src/styles/comic.css", import.meta.url), "utf8");
    assert.match(css, /\.comic-preparing-layer \{[^}]*pointer-events: none/);
    assert.doesNotMatch(css, /\.comic-preparing \{[^}]*inset: 0/, "não é um modal por cima da página");
  });

  it("o número de páginas continua vindo do documento, nunca de um valor fixo", () => {
    for (const file of ["views/ComicReaderView.ts", "reader/comic/interaction/ComicConverter.ts"]) {
      assert.doesNotMatch(source(file), /\b(?:totalPages|pageCount)\s*=\s*36\b/, file);
    }
  });

  it("o motor de virada e o de livros seguem fora do caminho", () => {
    const controller = source("reader/comic/ComicTurnController.ts");
    assert.match(controller, /threshold: \.32/); assert.match(controller, /flick: \.35/);
    for (const file of ["reader/comic/interaction/ComicHitMap.ts", "reader/comic/interaction/ComicBubbleLayout.ts",
      "reader/comic/interaction/ComicBubbleView.ts", "reader/comic/interaction/ComicSilhouette.ts"]) {
      assert.doesNotMatch(source(file), /page-turn\/|reader\/desktop\/|reflow\/|PageTurnEngine/, file);
    }
  });
});
