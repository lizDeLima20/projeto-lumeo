import { ComicLayout, type ComicGeometry } from "./ComicLayout";
import { ComicFoldGeometry, type ComicFold, type ComicPoint } from "./ComicFoldGeometry";
import type { ComicTurnDirection, ComicTurnPlan } from "./ComicSpreadMap";

/** What the controller needs from the reader. It never touches the DOM pages itself. */
export interface ComicTurnHost {
  geometry(): ComicGeometry;
  plan(direction: ComicTurnDirection): ComicTurnPlan | null;
  /** True when every bitmap the plan draws is already rendered. */
  ready(plan: ComicTurnPlan): boolean;
  prepare(plan: ComicTurnPlan): Promise<void>;
  drawTurn(plan: ComicTurnPlan, fold: ComicFold): void;
  drawRest(): void;
  /** The turn landed: the reader moves to `plan.target`. */
  commit(plan: ComicTurnPlan): void;
  turning(active: boolean): void;
  /** A still tap on the stage, offered before any turn: the text-region layer answers true
   *  when it took it (opened, switched or closed a balloon). Never called for a swipe. */
  tap?(point: ComicPoint, durationMs: number): boolean;
}

export type ComicTurnState = "IDLE" | "PRESSED" | "DRAGGING" | "SETTLING";

/** Tunables, in one place. */
export const COMIC_TURN = {
  /** Pixels of travel before a press becomes a turn, and how horizontal it must be. A
   *  finger that wobbles during a tap stays under it: a tap is never a turn. */
  slop: 12, horizontalBias: 1.1,
  /** Share of the turn past which releasing completes it. */
  threshold: .32,
  /** A flick completes a turn on its own (px/ms)... */
  flick: .35,
  /** ...once it has actually travelled: a twitch is not a swipe. */
  flickMinPx: 24,
  /** A press this short and this still is a tap. */
  tapMs: 350,
  /** A tap on a text region may linger a little longer than a tap that turns. */
  regionTapMs: 650,
  /** Programmatic turns (tap, arrow, key). */
  turnMs: 820,
  /** Release: time to cover the remaining distance. */
  settleMinMs: 170, settleSpanMs: 480,
} as const;

interface Drag { plan: ComicTurnPlan; fold: ComicFoldGeometry; grab: ComicPoint; progress: number; lift: number; }

/** Page turning for comics. The hand holds the leaf:
 *
 *    DOWN     remember where the page was taken
 *    MOVE     the leaf follows continuously (progress and lift come from the pointer)
 *    RELEASE  distance + direction + velocity: finish the turn or lay it back
 *
 *  A tap, the arrows and the keyboard turn the very same leaf through the same frames.
 *  When a turn lands the next one can start at once: nothing needs to be "armed" first. */
export class ComicTurnController {
  private stateValue: ComicTurnState = "IDLE";
  private pointerId: number | null = null;
  private downX = 0; private downY = 0; private downTime = 0; private downTarget: EventTarget | null = null;
  private drag: Drag | null = null;
  private samples: { x: number; time: number }[] = [];
  private frame = 0;
  /** Lands the leaf in flight at once; null when nothing is animating. */
  private settling: (() => void) | null = null;

  public constructor(private readonly element: HTMLElement, private readonly host: ComicTurnHost) {}

  public get state(): ComicTurnState { return this.stateValue; }

  public bind(): void {
    this.element.addEventListener("pointerdown", this.down);
    this.element.addEventListener("pointermove", this.move);
    this.element.addEventListener("pointerup", this.up);
    this.element.addEventListener("pointercancel", this.cancel);
    this.element.addEventListener("lostpointercapture", this.lost);
  }

  public unbind(): void {
    this.element.removeEventListener("pointerdown", this.down);
    this.element.removeEventListener("pointermove", this.move);
    this.element.removeEventListener("pointerup", this.up);
    this.element.removeEventListener("pointercancel", this.cancel);
    this.element.removeEventListener("lostpointercapture", this.lost);
    this.finishNow();
    cancelAnimationFrame(this.frame); this.frame = 0;
    this.reset();
  }

  /** Drops whatever turn is in progress, before the geometry changes under it (a resize,
   *  a rotation): a landing leaf lands, a leaf in the hand is laid back. */
  public interrupt(): void {
    this.finishNow();
    if (this.stateValue === "IDLE") return;
    this.release();
    const turning = this.stateValue === "DRAGGING";
    this.reset();
    if (turning) { this.host.turning(false); this.host.drawRest(); }
  }

  /** A whole turn without a hand on the leaf: tap, arrow button, arrow key. */
  public async turn(direction: ComicTurnDirection): Promise<boolean> {
    this.finishNow();
    if (this.stateValue !== "IDLE") return false;
    const plan = this.host.plan(direction); if (!plan) return false;
    this.stateValue = "SETTLING";
    if (!this.host.ready(plan)) await this.host.prepare(plan);
    const geometry = this.host.geometry();
    const fold = new ComicFoldGeometry(ComicLayout.slot(geometry, "right"));
    // The lower corner is lifted and carried across, as a hand turns a page.
    const grab = fold.grabAt(geometry.top + geometry.pageHeight * .86);
    this.drag = { plan, fold, grab, progress: plan.reversed ? 1 : 0, lift: -geometry.pageHeight * .2 };
    this.host.turning(true);
    return new Promise(resolve => this.animate(plan.reversed ? 0 : 1, COMIC_TURN.turnMs, easeInOut, () => { this.land(true); resolve(true); }));
  }

  private readonly down = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary) return;
    // An open balloon owns every gesture inside it (reading, scrolling a long one).
    if (within(event.target, ".comic-block, .comic-fab, .comic-arrow, .comic-overlay--open, .comic-bubble")) return;
    // A new hand on the page while the last leaf is still landing: land it now.
    this.finishNow();
    if (this.stateValue !== "IDLE") return;
    this.stateValue = "PRESSED";
    this.pointerId = event.pointerId;
    this.downX = event.clientX; this.downY = event.clientY; this.downTime = event.timeStamp; this.downTarget = event.target;
    this.samples = [{ x: event.clientX, time: event.timeStamp }];
    this.element.setPointerCapture?.(event.pointerId);
  };

  private readonly move = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    const point = this.local(event);
    this.samples.push({ x: event.clientX, time: event.timeStamp });
    if (this.samples.length > 6) this.samples.shift();
    if (this.stateValue === "PRESSED") {
      const dx = event.clientX - this.downX, dy = event.clientY - this.downY;
      if (Math.abs(dx) < COMIC_TURN.slop || Math.abs(dx) <= Math.abs(dy) * COMIC_TURN.horizontalBias) return;
      if (!this.start(dx)) { this.stateValue = "IDLE"; this.release(); return; }
    }
    if (this.stateValue !== "DRAGGING" || !this.drag) return;
    event.preventDefault();
    this.follow(point);
  };

  private readonly up = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    const state = this.stateValue;
    this.release();
    if (state === "PRESSED") {
      this.stateValue = "IDLE";
      const still = Math.hypot(event.clientX - this.downX, event.clientY - this.downY) < COMIC_TURN.slop;
      const hotspot = within(this.downTarget, ".comic-hotspot");
      const duration = event.timeStamp - this.downTime;
      if (still && !hotspot) {
        // The text layer decides first: a region opens its balloon, and while one is open
        // any tap only closes or switches it - never turns the page by accident.
        if (duration < COMIC_TURN.regionTapMs && this.host.tap?.(this.local(event), duration)) return;
        if (duration < COMIC_TURN.tapMs) {
          const side = this.tapSide(this.local(event));
          if (side) void this.turn(side);
        }
      }
      return;
    }
    if (state !== "DRAGGING" || !this.drag) return;
    this.follow(this.local(event));
    const velocity = this.velocity();
    const drag = this.drag;
    // In the leaf's own terms: forward is "towards 1", a reversed (backward) turn "towards 0".
    const turned = drag.plan.reversed ? 1 - drag.progress : drag.progress;
    const fling = drag.plan.reversed ? velocity : -velocity;
    const travelled = Math.abs(event.clientX - this.downX);
    const complete = turned > COMIC_TURN.threshold || (fling > COMIC_TURN.flick && turned > .02 && travelled >= COMIC_TURN.flickMinPx);
    void this.settle(complete);
  };

  private readonly cancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    const state = this.stateValue;
    this.release();
    if (state === "DRAGGING") void this.settle(false);
    else if (state === "PRESSED") this.stateValue = "IDLE";
  };

  private readonly lost = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.cancel(event);
  };

  /** Decides what the gesture is turning. On a phone the direction of the swipe does; on
   *  the open book it is the page that was taken: the right one goes forward, the left one
   *  back - and only by being pulled towards the other side. */
  private start(dx: number): boolean {
    const geometry = this.host.geometry();
    const origin = this.local({ clientX: this.downX, clientY: this.downY });
    let direction: ComicTurnDirection = dx < 0 ? 1 : -1;
    if (geometry.mode === "spread") {
      const side: ComicTurnDirection = origin.x >= geometry.spineX ? 1 : -1;
      if (side !== direction) return false;
      direction = side;
    }
    const plan = this.host.plan(direction); if (!plan) return false;
    const fold = new ComicFoldGeometry(ComicLayout.slot(geometry, "right"));
    this.drag = { plan, fold, grab: fold.grabAt(origin.y), progress: plan.reversed ? 1 : 0, lift: 0 };
    this.stateValue = "DRAGGING";
    this.host.turning(true);
    // Bitmaps are rendered ahead of time; if one is still missing the leaf waits for it
    // rather than turning over an empty page.
    if (!this.host.ready(plan)) void this.host.prepare(plan).then(() => { if (this.drag?.plan === plan) this.paint(); });
    return true;
  }

  /** Pointer -> progress. On the open book the leaf's edge travels with the mouse; on a
   *  phone it travels twice the finger, so a thumb's swipe across the screen is a turn. */
  private follow(point: ComicPoint): void {
    const drag = this.drag; if (!drag) return;
    const geometry = this.host.geometry();
    const span = geometry.mode === "spread" ? geometry.pageWidth * 2 : geometry.pageWidth;
    const origin = this.local({ clientX: this.downX, clientY: this.downY });
    const moved = (point.x - origin.x) / Math.max(1, span);
    drag.progress = Math.min(1, Math.max(0, drag.plan.reversed ? 1 - moved : -moved));
    drag.lift = point.y - origin.y;
    this.paint();
  }

  private paint(): void {
    const drag = this.drag; if (!drag || !this.host.ready(drag.plan)) return;
    this.host.drawTurn(drag.plan, drag.fold.fold(drag.grab, drag.progress, drag.lift));
  }

  private async settle(complete: boolean): Promise<void> {
    const drag = this.drag; if (!drag) return;
    this.stateValue = "SETTLING";
    const target = complete === !drag.plan.reversed ? 1 : 0;
    const duration = COMIC_TURN.settleMinMs + COMIC_TURN.settleSpanMs * Math.abs(target - drag.progress);
    if (!this.host.ready(drag.plan)) await this.host.prepare(drag.plan);
    this.animate(target, duration, easeOut, () => this.land(complete));
  }

  /** Drives progress to `target` frame by frame; the lift fades as the leaf lands. `done`
   *  runs exactly once - at the last frame, or right away if another gesture cuts in. */
  private animate(target: number, duration: number, ease: (t: number) => number, done: () => void): void {
    const drag = this.drag; if (!drag) { done(); return; }
    const from = drag.progress, lift = drag.lift, started = performance.now();
    let finished = false;
    const finish = (): void => {
      if (finished) return; finished = true;
      cancelAnimationFrame(this.frame); this.frame = 0; this.settling = null;
      drag.progress = target; done();
    };
    this.settling = finish;
    const step = (now: number): void => {
      if (finished) return;
      const t = Math.min(1, Math.max(0, (now - started) / Math.max(1, duration)));
      drag.progress = from + (target - from) * ease(t);
      drag.lift = lift * (1 - t);
      this.paint();
      if (t < 1) { this.frame = requestAnimationFrame(step); return; }
      finish();
    };
    this.frame = requestAnimationFrame(step);
  }

  /** The turn is over either way: commit or restore, then no trace of it is left. */
  private land(complete: boolean): void {
    const plan = this.drag?.plan ?? null;
    this.reset();
    this.host.turning(false);
    if (complete && plan) this.host.commit(plan);
    else this.host.drawRest();
  }

  /** Lands a leaf that is still moving, immediately, so the next gesture starts clean. */
  private finishNow(): void {
    if (this.stateValue === "SETTLING") this.settling?.();
  }

  private reset(): void {
    this.drag = null; this.stateValue = "IDLE"; this.samples = [];
  }

  private release(): void {
    const id = this.pointerId; this.pointerId = null;
    if (id !== null && this.element.hasPointerCapture?.(id)) this.element.releasePointerCapture(id);
  }

  private tapSide(point: ComicPoint): ComicTurnDirection | null {
    const geometry = this.host.geometry();
    if (geometry.mode === "spread") {
      if (point.y < geometry.top || point.y > geometry.top + geometry.pageHeight) return null;
      if (point.x >= geometry.spineX && point.x <= geometry.spineX + geometry.pageWidth) return 1;
      if (point.x < geometry.spineX && point.x >= geometry.spineX - geometry.pageWidth) return -1;
      return null;
    }
    // On a phone a tap never turns the page - not even on its edges. Only pressing and
    // dragging the leaf sideways does; a tap is left to the balloons.
    return null;
  }

  private velocity(): number {
    const first = this.samples[0], last = this.samples[this.samples.length - 1];
    if (!first || !last || last.time <= first.time) return 0;
    return (last.x - first.x) / (last.time - first.time);
  }

  private local(event: { clientX: number; clientY: number }): ComicPoint {
    const box = this.element.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }
}

/** Sine in-out: the leaf is visibly on its way from the first frames, and lands softly. */
const easeInOut = (t: number): number => (1 - Math.cos(Math.PI * t)) / 2;
const within = (target: EventTarget | null, selector: string): boolean =>
  typeof Element !== "undefined" && target instanceof Element && target.closest(selector) !== null;
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
