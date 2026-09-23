import { startsDesktopTurn, usesDesktopMouseTurn } from "../desktop/DesktopTurnPolicy";
import { FlexiblePageCurl } from "../page-turn/FlexiblePageCurl";
import { PageGestureIntent } from "../page-turn/PageGestureIntent";
import { PageGeometry } from "../page-turn/PageGeometry";
import { PageTurnEngine, type TurnDirection } from "../page-turn/PageTurnEngine";

/** Physical turn for the one-page reflow layout.
 *
 * The desktop used to keep the mobile controller here. Consequently a mouse press over
 * text was rejected and an arrow completed before both page textures were ready. The
 * spread reader already solved both problems; this controller applies the same policy to
 * the one-page Web layout without changing the Android path. */
export class PageTurnController {
  private readonly desktop = usesDesktopMouseTurn();
  private readonly flexible = new FlexiblePageCurl(this.desktop);
  private readonly engine: PageTurnEngine;
  private readonly intent = new PageGestureIntent();
  private active = false;
  private busy = false;
  private pointerId: number | null = null;
  private captured: HTMLElement | null = null;

  public constructor(private readonly element: HTMLElement, next: () => void, previous: () => void) {
    this.engine = new PageTurnEngine(element, element.nextElementSibling as HTMLElement | null,
      direction => (direction === 1 ? next : previous)(),
      new PageGeometry(PageGeometry.singlePageSpanFactor), undefined, undefined, undefined, this.flexible);
  }

  public bind(): void {
    this.element.addEventListener("pointerdown", this.down);
    this.element.addEventListener("pointermove", this.move);
    this.element.addEventListener("pointerup", this.up);
    this.element.addEventListener("pointercancel", this.cancel);
    this.element.addEventListener("lostpointercapture", this.lost);
    // Start both face captures while the reader is idle. The DOM page remains visible
    // until the WebGL sheet is completely ready. Photographing a page is heavy: it waits
    // for an idle moment so it never lands on the frames that follow a turn.
    const warm = (): void => this.flexible.prepare(this.element);
    if (typeof requestIdleCallback === "function") requestIdleCallback(warm, { timeout: 500 });
    else if (typeof requestAnimationFrame === "function") requestAnimationFrame(warm);
  }

  public unbind(): void {
    this.element.removeEventListener("pointerdown", this.down);
    this.element.removeEventListener("pointermove", this.move);
    this.element.removeEventListener("pointerup", this.up);
    this.element.removeEventListener("pointercancel", this.cancel);
    this.element.removeEventListener("lostpointercapture", this.lost);
    this.intent.release(); this.releasePointer();
  }

  public dragProgress(deltaX: number, width: number): number {
    return Math.min(1, Math.abs(deltaX) / Math.max(1, width));
  }

  public async turn(direction: TurnDirection): Promise<boolean> {
    if (this.busy || this.intent.active) return false;
    this.busy = true;
    try {
      if (this.desktop) await this.flexible.prepareReady(this.element);
      return await this.engine.programmatic(direction, this.desktop ? PageTurnEngine.desktopTurn : undefined);
    } finally { this.busy = false; }
  }

  private readonly down = (event: PointerEvent): void => {
    if (this.busy || this.intent.active) return;
    if (!(this.desktop ? startsDesktopTurn(event) : PageGestureIntent.startsTurn(event))) return;
    this.intent.arm(event.clientX, event.clientY);
    this.engine.prepare(event.clientX, event.clientY);
    if (this.desktop && event.pointerType === "mouse") {
      event.preventDefault();
      // The DOM sheet keeps its box while only its WebGL child deforms, so it is itself
      // the stationary capture target. Capturing its parent would retarget subsequent
      // pointermove events away from the listeners installed on this sheet.
      this.captured = this.element;
      this.pointerId = event.pointerId;
      this.captured.setPointerCapture(event.pointerId);
    }
  };

  private readonly move = (event: PointerEvent): void => {
    if (this.pointerId !== null && event.pointerId !== this.pointerId) return;
    if (!this.intent.accepts(event.clientX, event.clientY)) return;
    if (!this.active) {
      const direction: TurnDirection = event.clientX < this.intent.origin ? 1 : -1;
      if (!this.engine.begin(this.intent.origin, event.timeStamp, direction, event.clientY)) return;
      this.active = true;
      if (!this.captured) {
        this.captured = this.element;
        this.pointerId = event.pointerId;
        this.captured.setPointerCapture(event.pointerId);
      }
    }
    if (this.desktop) event.preventDefault();
    this.engine.move(event.clientX, event.timeStamp, event.clientY);
  };

  private readonly up = (event: PointerEvent): void => {
    if (this.pointerId !== null && event.pointerId !== this.pointerId) return;
    this.intent.release();
    if (!this.active) { this.releasePointer(); return; }
    this.active = false; this.releasePointer(); this.busy = true;
    void this.engine.end(event.clientX, event.timeStamp, event.clientY).finally(() => { this.busy = false; });
  };

  /* Android's WebView hands the touch capture back in the middle of a swipe - the finger
     is still down and the leaf is still being dragged. Treating that as a cancellation
     aborted every turn on the phone. Only a mouse losing capture means the drag is over. */
  private readonly lost = (event: PointerEvent): void => { if (event.pointerType === "mouse") this.cancel(); };

  private readonly cancel = (): void => {
    this.intent.release();
    if (!this.active) { this.releasePointer(); return; }
    this.active = false; this.releasePointer(); this.busy = true;
    void this.engine.cancel().finally(() => { this.busy = false; });
  };

  private releasePointer(): void {
    const id = this.pointerId, target = this.captured;
    this.pointerId = null; this.captured = null;
    if (id !== null && target?.hasPointerCapture?.(id)) target.releasePointerCapture(id);
  }
}
