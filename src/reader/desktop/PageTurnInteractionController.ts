import { PageTurnEngine, type TurnDirection } from "../page-turn/PageTurnEngine";
import { FlexiblePageCurl } from "../page-turn/FlexiblePageCurl";
import { PageGestureIntent } from "../page-turn/PageGestureIntent";
import { PageGeometry } from "../page-turn/PageGeometry";
import { startsDesktopTurn, usesDesktopMouseTurn } from "./DesktopTurnPolicy";

export interface CoverTurnActions { open?:()=>void; close?:()=>void; onStart?:(direction:TurnDirection)=>void; onSettling?:(direction:TurnDirection)=>void; onFinished?:()=>void; }

export class PageTurnInteractionController {
  private engine: PageTurnEngine | null = null;
  private readonly desktop = usesDesktopMouseTurn();
  private readonly textures = new FlexiblePageCurl(this.desktop);
  private readonly intent = new PageGestureIntent();
  private warmFrame = 0;
  private warmIdle = 0;
  private active = false;
  private busy = false;
  private disposed = false;
  private side: TurnDirection = 1;
  private pointerId: number | null = null;
  private captured: HTMLElement | null = null;

  public constructor(private readonly root: HTMLElement, private readonly next:()=>void,
    private readonly previous:()=>void, private readonly cover: CoverTurnActions = {}) {}

  public bind(): void {
    this.root.addEventListener("pointerdown", this.down);
    this.root.addEventListener("pointermove", this.move);
    this.root.addEventListener("pointerup", this.up);
    this.root.addEventListener("pointercancel", this.cancel);
    this.root.addEventListener("lostpointercapture", this.lost);
    window.addEventListener("blur", this.cancel);
    document.addEventListener("visibilitychange", this.visibility);
    this.warm();
  }
  public unbind(): void {
    this.disposed = true;
    this.coolDown();
    this.root.removeEventListener("pointerdown", this.down);
    this.root.removeEventListener("pointermove", this.move);
    this.root.removeEventListener("pointerup", this.up);
    this.root.removeEventListener("pointercancel", this.cancel);
    this.root.removeEventListener("lostpointercapture", this.lost);
    window.removeEventListener("blur", this.cancel);
    document.removeEventListener("visibilitychange", this.visibility);
    this.cancel();
  }
  private warm(): void {
    if (typeof requestAnimationFrame !== "function") return;
    this.warmFrame = requestAnimationFrame(() => {
      this.warmFrame = requestAnimationFrame(() => {
        this.warmFrame = 0;
        this.prepareLeaf(1);
        const later = () => { this.warmIdle = 0; this.prepareLeaf(-1); };
        this.warmIdle = typeof requestIdleCallback === "function"
          ? requestIdleCallback(later, { timeout: 1500 }) : window.setTimeout(later, 400);
      });
    });
  }
  private prepareLeaf(side: TurnDirection): void {
    const page = this.root.querySelector<HTMLElement>(side === 1 ? ".open-book-page--right" : ".open-book-page--left");
    if (page?.isConnected && !page.classList.contains("open-book-page--cover")) this.textures.prepare(page);
  }
  private coolDown(): void {
    if (this.warmFrame) cancelAnimationFrame(this.warmFrame);
    if (this.warmIdle) {
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(this.warmIdle);
      else window.clearTimeout(this.warmIdle);
    }
    this.warmFrame = this.warmIdle = 0;
  }
  public shouldComplete(delta: number, width: number): boolean { return new PageGeometry().progressFor(delta, width) >= .3; }
  public async turn(direction: TurnDirection): Promise<boolean> {
    if (this.desktop && (this.busy || this.intent.active)) return false;
    const page = this.page(direction);
    if (this.desktop) this.busy = true;
    try {
      if (this.desktop && !page.classList.contains("open-book-page--cover")) await this.textures.prepareReady(page);
      if (this.disposed) return false;
      this.engine = this.create(page);
      return await this.engine.programmatic(direction, this.desktop ? PageTurnEngine.desktopTurn : undefined);
    } catch { return false; }
    finally { this.busy = false; }
  }
  private readonly down = (event: PointerEvent): void => {
    if (this.desktop && (this.busy || this.intent.active)) return;
    if (!(this.desktop ? startsDesktopTurn(event) : PageGestureIntent.startsTurn(event))) return;
    const box = this.root.getBoundingClientRect();
    this.side = event.clientX >= box.left + box.width / 2 ? 1 : -1;
    this.intent.arm(event.clientX, event.clientY);
    const page = this.page(this.side);
    this.engine = this.create(page);
    this.engine.prepare(event.clientX, event.clientY);
    if (this.desktop && event.pointerType === "mouse") {
      event.preventDefault();
      // Keep capture on the stationary spread, not the composited moving leaf.
      this.captured = this.root; this.pointerId = event.pointerId;
      this.root.setPointerCapture(event.pointerId);
    }
  };
  private readonly move = (event: PointerEvent): void => {
    if (this.desktop && this.pointerId !== null && event.pointerId !== this.pointerId) return;
    if (!this.intent.accepts(event.clientX, event.clientY)) return;
    const delta = this.intent.deltaX(event.clientX);
    if (this.side === 1 && delta > 0 || this.side === -1 && delta < 0) return;
    if (!this.active) {
      const page = this.page(this.side);
      this.engine ??= this.create(page);
      if (!this.engine.begin(this.intent.origin, event.timeStamp, this.side, event.clientY)) return;
      this.active = true;
      this.cover.onStart?.(this.side);
      this.captured = this.desktop ? this.root : page; this.pointerId = event.pointerId;
      this.captured.setPointerCapture(event.pointerId);
    }
    if (this.desktop) event.preventDefault();
    this.engine?.move(event.clientX, event.timeStamp, event.clientY);
  };
  private readonly up = (event: PointerEvent): void => {
    if (this.desktop && this.pointerId !== null && event.pointerId !== this.pointerId) return;
    const delta = this.intent.deltaX(event.clientX);
    this.intent.release();
    if (!this.active) { this.releasePointer(); return; }
    this.active = false;
    this.releasePointer();
    this.busy = this.desktop;
    this.cover.onSettling?.(this.side);
    const valid = this.side === 1 ? delta <= 0 : delta >= 0;
    const work = valid ? this.engine?.end(event.clientX, event.timeStamp, event.clientY) : this.engine?.cancel();
    void work?.finally(() => { this.busy = false; this.cover.onFinished?.(); });
  };
  /* Android's WebView hands a touch capture back in the middle of a swipe, with the finger
     still on the leaf. Only a mouse losing capture (another window, a drag that left the
     page) means the gesture is over. */
  private readonly lost = (event: PointerEvent): void => { if (event.pointerType === "mouse") this.cancel(); };

  private readonly cancel = (): void => {
    this.intent.release();
    if (!this.active) { this.releasePointer(); return; }
    this.active = false;
    this.releasePointer();
    this.busy = this.desktop;
    this.cover.onSettling?.(this.side);
    void this.engine?.cancel().finally(() => { this.busy = false; this.cover.onFinished?.(); });
  };
  private readonly visibility = (): void => { if (document.visibilityState !== "visible") this.cancel(); };
  private releasePointer(): void {
    const id = this.pointerId, page = this.captured;
    this.pointerId = null; this.captured = null;
    if (id !== null && page?.hasPointerCapture?.(id)) page.releasePointerCapture(id);
  }
  private page(direction: TurnDirection): HTMLElement {
    return this.root.querySelector<HTMLElement>(direction === 1 ? ".open-book-page--right" : ".open-book-page--left")
      ?? this.root.querySelector<HTMLElement>(".open-book-page--cover") ?? this.root;
  }
  private create(page: HTMLElement): PageTurnEngine {
    const isClosedCover = page.classList.contains("open-book-page--cover") && this.root.classList.contains("open-book-layout--closed");
    const isOpenCover = this.root.classList.contains("open-book-layout--open-cover");
    const selector = isClosedCover ? ".open-book-page--under-cover" : page.classList.contains("open-book-page--right") ? ".open-book-page--under-right" : ".open-book-page--under-left";
    const under = page.parentElement?.querySelector<HTMLElement>(selector) ?? null;
    return new PageTurnEngine(page, under, direction => {
      if (isClosedCover && direction === 1) { this.cover.open?.(); return; }
      if (isOpenCover && direction === -1) { this.cover.close?.(); return; }
      (direction === 1 ? this.next : this.previous)();
    }, undefined, undefined, undefined, undefined, new FlexiblePageCurl(this.desktop));
  }
}
