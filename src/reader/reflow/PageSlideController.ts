import { PageGestureIntent } from "../page-turn/PageGestureIntent";

/** "Deslizar horizontal": pages as a flat carousel - no curl, no fold, just a straight
 *  slide between the previous, current and next sheet already sitting in the DOM. Reuses
 *  PageGestureIntent's own rule (touch turns a page from anywhere, a mouse press on text
 *  selects instead) so the two animations feel like the same reader underneath. */
export class PageSlideController {
  private static readonly commitShare = .32;
  private dragging = false;
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private width = 0;

  public constructor(private readonly host: HTMLElement, private readonly next: () => void, private readonly previous: () => void) {}

  public bind(): void {
    this.host.addEventListener("pointerdown", this.down);
    this.host.addEventListener("pointermove", this.move);
    this.host.addEventListener("pointerup", this.up);
    this.host.addEventListener("pointercancel", this.cancel);
  }
  public unbind(): void {
    this.host.removeEventListener("pointerdown", this.down);
    this.host.removeEventListener("pointermove", this.move);
    this.host.removeEventListener("pointerup", this.up);
    this.host.removeEventListener("pointercancel", this.cancel);
    this.reset(0);
  }
  public turn(direction: 1 | -1): Promise<boolean> { (direction === 1 ? this.next : this.previous)(); return Promise.resolve(true); }

  private readonly down = (event: PointerEvent): void => {
    if (!PageGestureIntent.startsTurn(event)) return;
    this.startX = event.clientX; this.startY = event.clientY; this.width = this.host.clientWidth || 1;
    this.pointerId = event.pointerId; this.dragging = false;
  };
  private readonly move = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) return;
    const dx = event.clientX - this.startX, dy = event.clientY - this.startY;
    if (!this.dragging) {
      if (Math.abs(dx) < PageGestureIntent.slopPixels) return;
      if (Math.abs(dx) <= Math.abs(dy) * PageGestureIntent.horizontalBias) { this.pointerId = null; return; }
      this.dragging = true; this.host.setPointerCapture?.(event.pointerId); this.host.classList.add("page-slide-dragging");
    }
    this.applyDrag(dx);
  };
  private readonly up = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) return;
    const dx = event.clientX - this.startX;
    if (this.host.hasPointerCapture?.(event.pointerId)) this.host.releasePointerCapture(event.pointerId);
    this.pointerId = null;
    if (!this.dragging) return;
    this.dragging = false; this.host.classList.remove("page-slide-dragging");
    const before = this.sheet("before"), after = this.sheet("after");
    const commitNext = dx <= -this.width * PageSlideController.commitShare && Boolean(after);
    const commitPrevious = dx >= this.width * PageSlideController.commitShare && Boolean(before);
    this.reset(commitNext ? -1 : commitPrevious ? 1 : 0);
  };
  private readonly cancel = (): void => { this.pointerId = null; if (this.dragging) { this.dragging = false; this.host.classList.remove("page-slide-dragging"); this.reset(0); } };

  private sheet(relation: "before" | "current" | "after"): HTMLElement | null {
    return this.host.querySelector<HTMLElement>(`.reflow-sheet--${relation}`);
  }
  /** Dragging past an end of the book (no sheet to reveal) resists instead of gapping. */
  private applyDrag(dx: number): void {
    const before = this.sheet("before"), current = this.sheet("current"), after = this.sheet("after");
    const resisted = (dx > 0 && !before) || (dx < 0 && !after) ? dx * .25 : dx;
    if (before) before.style.transform = `translateX(calc(-100% + ${resisted}px))`;
    if (current) current.style.transform = `translateX(${resisted}px)`;
    if (after) after.style.transform = `translateX(calc(100% + ${resisted}px))`;
  }
  /** Animates to the settled position, then (if committing) swaps the page underneath -
   *  the incoming sheet is already fully rendered, so nothing is blank mid-transition. */
  private reset(commit: 0 | 1 | -1): void {
    const before = this.sheet("before"), current = this.sheet("current"), after = this.sheet("after");
    const sheets = [before, current, after].filter((value): value is HTMLElement => value !== null);
    sheets.forEach((sheet) => sheet.classList.add("page-slide-settling"));
    if (commit === -1) { current?.style.setProperty("transform", "translateX(-100%)"); after?.style.setProperty("transform", "translateX(0%)"); before?.style.setProperty("transform", "translateX(-200%)"); }
    else if (commit === 1) { current?.style.setProperty("transform", "translateX(100%)"); before?.style.setProperty("transform", "translateX(0%)"); after?.style.setProperty("transform", "translateX(200%)"); }
    else sheets.forEach((sheet) => sheet.style.removeProperty("transform"));
    window.setTimeout(() => {
      sheets.forEach((sheet) => { sheet.classList.remove("page-slide-settling"); sheet.style.removeProperty("transform"); });
      if (commit === -1) this.next(); else if (commit === 1) this.previous();
    }, commit === 0 ? 200 : 240);
  }
}
