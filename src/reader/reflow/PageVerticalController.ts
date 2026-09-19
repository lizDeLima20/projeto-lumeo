/** "Deslizar vertical": pages stacked as a native scroll-snap column, one sheet per
 *  viewport height. The browser owns the physics (momentum, rubber-band, a single page per
 *  swipe via scroll-snap-stop), so this controller only reads where the scroll settled and
 *  turns the page - it never drives the scroll position itself except to recentre after a
 *  turn, and it never lets the column become an open-ended document scroll. */
export class PageVerticalController {
  private settleTimer = 0;

  public constructor(private readonly host: HTMLElement, private readonly next: () => void, private readonly previous: () => void) {}

  public bind(): void {
    const height = this.host.clientHeight || 1;
    const children = [...this.host.children] as HTMLElement[];
    const index = children.findIndex((child) => child.classList.contains("reflow-sheet--current"));
    this.host.scrollTop = Math.max(0, index) * height;
    this.host.addEventListener("scroll", this.onScroll, { passive: true });
  }
  public unbind(): void { this.host.removeEventListener("scroll", this.onScroll); window.clearTimeout(this.settleTimer); }
  public turn(direction: 1 | -1): Promise<boolean> { (direction === 1 ? this.next : this.previous)(); return Promise.resolve(true); }

  private readonly onScroll = (): void => {
    window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(this.settle, 140);
  };
  private readonly settle = (): void => {
    const height = this.host.clientHeight || 1;
    const children = [...this.host.children] as HTMLElement[];
    if (!children.length) return;
    const index = Math.min(children.length - 1, Math.max(0, Math.round(this.host.scrollTop / height)));
    const landed = children[index];
    if (!landed || landed.classList.contains("reflow-sheet--current")) return;
    if (landed.classList.contains("reflow-sheet--before")) this.previous();
    else if (landed.classList.contains("reflow-sheet--after")) this.next();
  };
}
