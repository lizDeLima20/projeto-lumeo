import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { ComicLayout, SPREAD_MARGINS } from "../src/reader/comic/ComicLayout";
import { ComicSpreadMap, type ComicTurnPlan } from "../src/reader/comic/ComicSpreadMap";
import { ComicFoldGeometry, type ComicFold, type ComicPoint } from "../src/reader/comic/ComicFoldGeometry";
import { ComicTurnController, COMIC_TURN, type ComicTurnHost } from "../src/reader/comic/ComicTurnController";

const source = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const close = (a: number, b: number, epsilon = 1e-6): boolean => Math.abs(a - b) < epsilon;
const desktop = { native: false, finePointer: true };

describe("HQ: uma geometria para todos os estados", () => {
  it("celular, tablet e o app Android leem uma página; livro aberto só no desktop largo com mouse", () => {
    assert.equal(ComicLayout.mode(412, 915, desktop), "single");
    assert.equal(ComicLayout.mode(1280, 800, { native: true, finePointer: true }), "single");
    assert.equal(ComicLayout.mode(1280, 800, { native: false, finePointer: false }), "single");
    assert.equal(ComicLayout.mode(1000, 800, desktop), "single");
    assert.equal(ComicLayout.mode(1024, 1366, desktop), "single");
    assert.equal(ComicLayout.mode(1440, 900, desktop), "spread");
  });

  it("no celular a página ocupa a maior área possível sem deformar", () => {
    const geometry = ComicLayout.geometry("single", 412, 915, 1500 / 2306);
    assert.equal(geometry.pageWidth, 412);
    assert.ok(close(geometry.pageWidth / geometry.pageHeight, 1500 / 2306, .005));
    // Only the residue the proportion leaves, split evenly.
    assert.equal(geometry.top, Math.round((915 - geometry.pageHeight) / 2));
    const wide = ComicLayout.geometry("single", 915, 412, 1500 / 2306);
    assert.equal(wide.pageHeight, 412);
  });

  it("no desktop são duas páginas proporcionais e centradas, com margens - nunca um painel de parede a parede", () => {
    const geometry = ComicLayout.geometry("spread", 1920, 1080, 1500 / 2306);
    const left = ComicLayout.slot(geometry, "left"), right = ComicLayout.slot(geometry, "right");
    assert.equal(left.width, right.width); assert.equal(left.x + left.width, right.x);
    assert.equal(geometry.spineX, 960);
    assert.ok(geometry.pageHeight <= 1080 - SPREAD_MARGINS.top - SPREAD_MARGINS.bottom);
    assert.ok(left.x >= SPREAD_MARGINS.side);
    assert.ok(close(geometry.pageWidth / geometry.pageHeight, 1500 / 2306, .005));
  });

  it("páginas de outra proporção são contidas no mesmo espaço, sem cortar nem esticar", () => {
    const slot = { x: 10, y: 20, width: 400, height: 600 };
    const spread = ComicLayout.contain(slot, 3000, 2306);
    assert.ok(close(spread.width / spread.height, 3000 / 2306));
    assert.ok(spread.width <= slot.width + 1e-9 && spread.height <= slot.height + 1e-9);
    assert.equal(ComicLayout.aspect([.65, .65, 1.3, .65]), .65);
  });
});

describe("HQ: ordem física das folhas", () => {
  it("livro aberto: frente P, verso P+1, embaixo P+2 - e voltar é a mesma folha ao contrário", () => {
    const map = new ComicSpreadMap(36, "spread");
    assert.deepEqual(map.rest(0), { left: null, right: 1 });
    assert.deepEqual(map.rest(3), { left: 6, right: 7 });
    const forward = map.plan(3, 1)!;
    assert.deepEqual({ ...forward }, { staticLeft: 6, front: 7, back: 8, under: 9, reversed: false, target: 4 });
    const back = map.plan(4, -1)!;
    assert.deepEqual({ ...back }, { ...forward, reversed: true, target: 3 });
    // Landing positions give exactly the next rests: no page shown twice, none skipped.
    assert.deepEqual(map.rest(4), { left: forward.back, right: forward.under });
    assert.equal(map.plan(0, -1), null);
    assert.equal(map.plan(map.positions - 1, 1), null);
  });

  it("celular: a folha tem papel no verso e a próxima página embaixo", () => {
    const map = new ComicSpreadMap(24, "single");
    assert.deepEqual({ ...map.plan(5, 1)! }, { staticLeft: null, front: 5, back: null, under: 6, reversed: false, target: 6 });
    assert.deepEqual({ ...map.plan(5, -1)! }, { staticLeft: null, front: 4, back: null, under: 5, reversed: true, target: 4 });
    assert.equal(map.plan(1, -1), null); assert.equal(map.plan(24, 1), null);
  });

  it("as páginas que uma virada pode mostrar são conhecidas antes do gesto", () => {
    assert.deepEqual(new ComicSpreadMap(36, "spread").neededPages(3).sort((a, b) => a - b), [4, 5, 6, 7, 8, 9]);
    assert.deepEqual(new ComicSpreadMap(24, "single").neededPages(5).sort((a, b) => a - b), [4, 5, 6]);
  });

  it("trocar de modo mantém a página lida", () => {
    const spread = new ComicSpreadMap(36, "spread"), single = new ComicSpreadMap(36, "single");
    const page = spread.pageOfPosition(spread.positionOfPage(13));
    assert.equal(page, 12);
    assert.equal(single.pageOfPosition(single.positionOfPage(page)), 12);
  });
});

describe("HQ: a dobra da folha", () => {
  const slot = { x: 500, y: 60, width: 500, height: 770 };
  const fold = new ComicFoldGeometry(slot);
  const side = (f: ComicFold, p: ComicPoint): number => (p.x - f.origin.x) * f.normal.x + (p.y - f.origin.y) * f.normal.y;

  it("parada, a folha é exatamente a página: sem dobra e sem sobra", () => {
    const rest = fold.fold(fold.grabAt(400), 0, 120);
    assert.equal(rest.flap.length, 0);
    assert.deepEqual(rest.front, [{ x: 500, y: 60 }, { x: 1000, y: 60 }, { x: 1000, y: 830 }, { x: 500, y: 830 }]);
  });

  it("virada, o verso cobre exatamente a página da esquerda, na orientação certa", () => {
    const done = fold.fold(fold.grabAt(400), 1, 120);
    // At the end the arch is gone: placement is the pure reflection across the spine.
    const round = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;
    assert.deepEqual(done.placement.map(round), done.reflection.map(round));
    const xs = done.laid.map(p => p.x), ys = done.laid.map(p => p.y);
    assert.ok(close(Math.min(...xs), 0, 1e-6) && close(Math.max(...xs), 500, 1e-6));
    assert.ok(close(Math.min(...ys), 60, 1e-6) && close(Math.max(...ys), 830, 1e-6));
  });

  it("a lombada nunca se levanta, com qualquer puxão do dedo", () => {
    for (const progress of [.05, .2, .4, .5, .6, .8, .95]) {
      for (const lift of [-400, -150, 0, 150, 400]) {
        for (const y of [70, 300, 820]) {
          const f = fold.fold(fold.grabAt(y), progress, lift);
          for (const end of [{ x: 500, y: 60 }, { x: 500, y: 830 }]) assert.ok(side(f, end) <= 1e-6, `spine lifted at p=${progress} lift=${lift} y=${y}`);
        }
      }
    }
  });

  it("frente e verso dividem a página inteira, sem fresta e sem sobreposição", () => {
    const f = fold.fold(fold.grabAt(600), .4, -80);
    const area = (poly: ComicPoint[]): number => Math.abs(poly.reduce((sum, p, i) => { const q = poly[(i + 1) % poly.length]!; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;
    assert.ok(close(area(f.front) + area(f.flap), 500 * 770, 1e-3));
  });
});

describe("HQ: o gesto controla a própria folha", () => {
  class FakeElement {
    public listeners = new Map<string, (event: unknown) => void>();
    public captured = new Set<number>();
    public addEventListener(type: string, listener: (event: unknown) => void): void { this.listeners.set(type, listener); }
    public removeEventListener(type: string): void { this.listeners.delete(type); }
    public getBoundingClientRect(): DOMRect { return { left: 0, top: 0, width: 412, height: 915 } as DOMRect; }
    public setPointerCapture(id: number): void { this.captured.add(id); }
    public hasPointerCapture(id: number): boolean { return this.captured.has(id); }
    public releasePointerCapture(id: number): void { this.captured.delete(id); }
    public fire(type: string, x: number, time: number, y = 450): void {
      this.listeners.get(type)?.({ pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, timeStamp: time, target: null, preventDefault: () => undefined });
    }
  }
  function harness(): { element: FakeElement; controller: ComicTurnController; log: string[]; progress: number[]; flush: () => void; position: () => number } {
    const frames: ((now: number) => void)[] = [];
    let now = 0;
    Object.assign(globalThis, {
      requestAnimationFrame: (callback: (now: number) => void) => { frames.push(callback); return frames.length; },
      cancelAnimationFrame: () => undefined,
    });
    const realNow = performance.now.bind(performance);
    performance.now = () => now;
    const map = new ComicSpreadMap(10, "single");
    const geometry = ComicLayout.geometry("single", 412, 915, .65);
    let position = 3;
    const log: string[] = [], progress: number[] = [];
    const host: ComicTurnHost = {
      geometry: () => geometry,
      plan: direction => map.plan(position, direction),
      ready: () => true,
      prepare: async () => undefined,
      drawTurn: (_plan: ComicTurnPlan, fold: ComicFold) => { progress.push(fold.progress); },
      drawRest: () => { log.push("rest"); },
      commit: plan => { position = plan.target; log.push(`commit:${plan.target}`); },
      turning: active => { log.push(active ? "turning" : "still"); },
    };
    const element = new FakeElement();
    const controller = new ComicTurnController(element as unknown as HTMLElement, host);
    controller.bind();
    const flush = (): void => { for (let i = 0; i < 200 && frames.length; i++) { now += 16; frames.shift()!(now); } performance.now = realNow; performance.now = () => now; };
    return { element, controller, log, progress, flush, position: () => position };
  }

  it("arrastar além do limite e soltar completa a virada - sem botão nenhum", () => {
    const { element, controller, log, progress, flush, position } = harness();
    element.fire("pointerdown", 380, 0);
    for (let x = 370, t = 16; x >= 120; x -= 25, t += 16) element.fire("pointermove", x, t);
    // The leaf followed the finger the whole way, continuously.
    assert.ok(progress.length > 5 && progress.every((value, i) => i === 0 || value >= progress[i - 1]! - 1e-9));
    element.fire("pointerup", 120, 400);
    flush();
    assert.deepEqual(log, ["turning", "still", "commit:4"]);
    assert.equal(position(), 4); assert.equal(controller.state, "IDLE");
    // The next swipe starts at once: nothing needs arming first.
    element.fire("pointerdown", 380, 1000);
    for (let x = 370, t = 1016; x >= 100; x -= 30, t += 16) element.fire("pointermove", x, t);
    element.fire("pointerup", 100, 1400); flush();
    assert.equal(position(), 5);
  });

  it("um arrasto curto e lento volta suavemente ao lugar", () => {
    const { element, log, flush, position } = harness();
    element.fire("pointerdown", 380, 0);
    for (let x = 370, t = 50; x >= 340; x -= 10, t += 120) element.fire("pointermove", x, t);
    element.fire("pointerup", 340, 700); flush();
    assert.deepEqual(log, ["turning", "still", "rest"]);
    assert.equal(position(), 3);
  });

  it("um peteleco rápido completa mesmo com pouca distância", () => {
    const { element, flush, position } = harness();
    element.fire("pointerdown", 380, 0);
    element.fire("pointermove", 360, 10); element.fire("pointermove", 330, 20); element.fire("pointermove", 300, 30);
    element.fire("pointerup", 300, 40); flush();
    assert.equal(position(), 4);
  });

  it("arrastar para a direita volta uma página", () => {
    const { element, flush, position } = harness();
    element.fire("pointerdown", 40, 0);
    for (let x = 60, t = 16; x <= 330; x += 30, t += 16) element.fire("pointermove", x, t);
    element.fire("pointerup", 330, 300); flush();
    assert.equal(position(), 2);
  });

  it("toque na borda vira pela mesma folha; o meio da página fica para os balões", async () => {
    const { element, flush, position } = harness();
    element.fire("pointerdown", 390, 0); element.fire("pointerup", 390, 80);
    await Promise.resolve(); await Promise.resolve(); flush();
    assert.equal(position(), 4);
    element.fire("pointerdown", 206, 500); element.fire("pointerup", 206, 560);
    await Promise.resolve(); flush();
    assert.equal(position(), 4);
  });

  it("os parâmetros do gesto ficam num lugar só", () => {
    assert.ok(COMIC_TURN.threshold > 0 && COMIC_TURN.threshold < .5);
    assert.ok(COMIC_TURN.flick > 0);
  });
});

describe("HQ: motor isolado do Reader de livros", () => {
  const comicFiles = [
    "views/ComicReaderView.ts",
    ...readdirSync(new URL("../src/reader/comic/", import.meta.url)).map(name => `reader/comic/${name}`),
  ];
  it("o motor de HQ não usa o motor, o CSS nem as capturas dos livros", () => {
    for (const file of comicFiles) {
      const code = source(file);
      assert.doesNotMatch(code, /page-turn\/|reader\/desktop\/|reflow\/|html2canvas|PageTurnEngine|FlexiblePageCurl/, file);
      assert.doesNotMatch(code, /reflow-sheet|open-book-|page-turn-/, file);
    }
  });
  it("o leitor de HQ não tem barra própria no rodapé", () => {
    const view = source("views/ComicReaderView.ts");
    assert.doesNotMatch(view, /comic-controls|comic-indicator/);
    assert.match(view, /comic-fab comic-fab--back/);
    assert.doesNotMatch(readFileSync(new URL("../src/styles/comic.css", import.meta.url), "utf8"), /\.comic-controls/);
  });
});
