import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PageTurnInteractionController } from "../src/reader/desktop/PageTurnInteractionController";
import { startsDesktopTurn, usesDesktopMouseTurn } from "../src/reader/desktop/DesktopTurnPolicy";
import { PageGestureIntent } from "../src/reader/page-turn/PageGestureIntent";
import { PageTurnController } from "../src/reader/reflow/PageTurnController";
import { readFileSync } from "node:fs";

class FakeElement extends EventTarget {
  public style = {};
  public parentElement: FakeElement | null = null;
  public classList = { contains: () => false };
  public pointer: number | null = null;
  public constructor(public text = false, public control = false) { super(); }
  public closest(selector: string): FakeElement | null {
    return (selector === "[data-block-id]" ? this.text : this.control) ? this : null;
  }
  public getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 700 }; }
  public querySelector() { return this; }
  public setPointerCapture(id: number) { this.pointer = id; }
  public hasPointerCapture(id: number) { return this.pointer === id; }
  public releasePointerCapture() { this.pointer = null; }
}

const scope = globalThis as unknown as Record<string, unknown>;
const saved = new Map<string, PropertyDescriptor | undefined>();
before(() => {
  for (const [key, value] of Object.entries({ Element: FakeElement, getSelection: () => null,
    matchMedia: () => ({ matches: true }), window: new EventTarget(), document: new EventTarget() })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
});
after(() => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete scope[key]; } });

function pointer(type: string, x: number, options: Record<string, unknown> = {}): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, Object.fromEntries(Object.entries({ clientX: x, clientY: 100,
    button: 0, pointerType: "mouse", pointerId: 1, shiftKey: false, detail: 1, ...options }).map(([key,value]) => [key,{value}])));
  return event;
}

function harness() {
  const root = new FakeElement(true), calls: unknown[][] = [];
  let release: (() => void) | undefined;
  const engine = {
    prepare: (...args: unknown[]) => calls.push(["prepare", ...args]),
    begin: (...args: unknown[]) => { calls.push(["begin", ...args]); return true; },
    move: (...args: unknown[]) => calls.push(["move", ...args]),
    end: (...args: unknown[]) => { calls.push(["end", ...args]); return new Promise<void>(r => { release = r; }); },
    cancel: () => { calls.push(["cancel"]); return Promise.resolve(); },
    programmatic: (direction: number) => { calls.push(["programmatic", direction]); return Promise.resolve(true); },
  };
  const controller = new PageTurnInteractionController(root as unknown as HTMLElement, () => calls.push(["next"]), () => calls.push(["previous"]));
  const internal = controller as unknown as { create: () => typeof engine; textures: { prepareReady: () => Promise<void> } };
  internal.create = () => engine;
  internal.textures.prepareReady = async () => { calls.push(["ready"]); };
  controller.bind();
  return { root, calls, controller, finish: () => release?.() };
}

describe("desktop mouse turn isolation", () => {
  it("permits mouse on paragraphs only through the desktop policy", () => {
    const event = { button: 0, pointerType: "mouse", target: new FakeElement(true), shiftKey: false, detail: 1 };
    assert.equal(startsDesktopTurn(event), true);
    assert.equal(PageGestureIntent.startsTurn(event), false);
    assert.equal(PageGestureIntent.startsTurn({ ...event, pointerType: "touch" }), true);
    assert.equal(startsDesktopTurn({ ...event, shiftKey: true }), false);
    assert.equal(startsDesktopTurn({ ...event, target: new FakeElement(false, true) }), false);
  });
  it("does not enable the desktop path at a mobile breakpoint", () => {
    const original = scope.matchMedia;
    scope.matchMedia = () => ({ matches: false });
    assert.equal(usesDesktopMouseTurn(), false);
    scope.matchMedia = original;
  });
  for (const [start, moves] of [[800,[790,700,600]], [200,[210,300,400]]] as const) {
    it(`captures and continuously forwards the mouse in direction ${start === 800 ? "next" : "previous"}`, async () => {
      const h = harness();
      const down = pointer("pointerdown", start); h.root.dispatchEvent(down);
      assert.equal(down.defaultPrevented, true);
      assert.equal(h.root.pointer, 1);
      for (const x of moves) h.root.dispatchEvent(pointer("pointermove", x));
      assert.equal(h.calls.filter(c => c[0] === "begin").length, 1);
      assert.deepEqual(h.calls.filter(c => c[0] === "move").map(c => c[1]), moves);
      h.root.dispatchEvent(pointer("pointerup", moves[2]));
      assert.equal(h.root.pointer, null);
      assert.equal(h.calls.filter(c => c[0] === "end").length, 1);
      assert.equal(await h.controller.turn(1), false, "settling blocks a competing click");
      h.finish(); await Promise.resolve(); h.controller.unbind();
    });
  }
  it("pointercancel returns the leaf without committing navigation", async () => {
    const h = harness(); h.root.dispatchEvent(pointer("pointerdown",800)); h.root.dispatchEvent(pointer("pointermove",780));
    h.root.dispatchEvent(pointer("pointercancel",780)); await Promise.resolve();
    assert.equal(h.calls.filter(c => c[0] === "cancel").length,1);
    assert.equal(h.calls.some(c => c[0] === "next" || c[0] === "previous"),false);
    h.controller.unbind();
  });
  it("keeps mouse capture on the stationary spread rather than its moving leaf", () => {
    const h = harness(), leaf = new FakeElement();
    h.root.querySelector = () => leaf;
    h.root.dispatchEvent(pointer("pointerdown", 800));
    h.root.dispatchEvent(pointer("pointermove", 760));
    assert.equal(h.root.pointer, 1);
    assert.equal(leaf.pointer, null);
    h.root.dispatchEvent(pointer("pointercancel", 760));
    h.controller.unbind();
  });
  it("arrows wait for both faces and use the same engine rather than navigating directly", async () => {
    const h = harness();
    assert.equal(await h.controller.turn(1),true);
    assert.deepEqual(h.calls,[["ready"],["programmatic",1]]);
    h.controller.unbind();
  });
  it("the one-page Web layout also waits for both faces before an arrow turn", async () => {
    const page = new FakeElement(), calls: string[] = [];
    const controller = new PageTurnController(page as unknown as HTMLElement, () => undefined, () => undefined);
    const internal = controller as unknown as {
      flexible: { prepareReady: () => Promise<void> };
      engine: { programmatic: () => Promise<boolean> };
    };
    internal.flexible.prepareReady = async () => { calls.push("ready"); };
    internal.engine.programmatic = async () => { calls.push("turn"); return true; };
    assert.equal(await controller.turn(1), true);
    assert.deepEqual(calls, ["ready", "turn"]);
  });
  it("scanned PDFs use the flexible engine on desktop Web and retain the legacy Android path", () => {
    const source = readFileSync(new URL("../src/reader/image/ImagePageTurnAnimator.ts", import.meta.url), "utf8");
    assert.match(source, /if \(usesDesktopMouseTurn\(\)\) \{ void this\.playDesktop/);
    assert.match(source, /new FlexiblePageCurl\(true\)/);
    assert.match(source, /new PageTurnEngine\(leaf, null/);
    assert.match(source, /reader-image-turn-leaf--\$\{direction\}/,
      "the existing non-desktop animation remains available for Android");
  });
});
