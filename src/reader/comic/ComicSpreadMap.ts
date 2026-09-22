import type { ComicLayoutMode } from "./ComicLayout";

export type ComicTurnDirection = 1 | -1;

/** What stays on screen while nothing turns. `null` is an empty slot (no page there). */
export interface ComicRestPages { left: number | null; right: number | null; }

/** One physical leaf turning forward, and everything it involves:
 *
 *    [ staticLeft ][ front ]   ->   [ back ][ under ]
 *
 *  The leaf's FRONT is the right page, its BACK is the page that lands on the left, and
 *  UNDER is the page lying below it, uncovered only where the leaf has left. A phone page
 *  has no printed back: `back` is null there and the leaf shows paper.
 *
 *  Going back is the same leaf played in reverse (`reversed`), so the physical order of the
 *  pages is one model for both directions. */
export interface ComicTurnPlan {
  staticLeft: number | null;
  front: number;
  back: number | null;
  under: number | null;
  reversed: boolean;
  /** The position shown once the turn completes. */
  target: number;
}

/** The comic's physical page order. A position is a page on a phone and a spread on the
 *  desktop: spread 0 is the cover alone on the right, then [2|3], [4|5]... */
export class ComicSpreadMap {
  public constructor(private readonly totalPages: number, public readonly mode: ComicLayoutMode) {}

  public get positions(): number { return this.mode === "single" ? this.totalPages : Math.floor(this.totalPages / 2) + 1; }

  public positionOfPage(page: number): number {
    const clamped = Math.min(Math.max(1, page), Math.max(1, this.totalPages));
    return this.mode === "single" ? clamped : Math.floor(clamped / 2);
  }

  /** The page a position is remembered by: the first one on screen. */
  public pageOfPosition(position: number): number {
    const rest = this.rest(position);
    return rest.left ?? rest.right ?? 1;
  }

  public rest(position: number): ComicRestPages {
    if (this.mode === "single") return { left: null, right: this.page(position) };
    return { left: position === 0 ? null : this.page(position * 2), right: this.page(position * 2 + 1) };
  }

  public plan(position: number, direction: ComicTurnDirection): ComicTurnPlan | null {
    if (direction === -1) {
      if (position <= this.first) return null;
      const forward = this.forward(position - 1);
      return forward ? { ...forward, reversed: true, target: position - 1 } : null;
    }
    return this.forward(position);
  }

  /** Every page a turn from `position` in either direction can show - the set to have
   *  rendered before the reader's finger or mouse touches the page. */
  public neededPages(position: number): number[] {
    const pages = new Set<number>();
    const add = (page: number | null): void => { if (page !== null) pages.add(page); };
    const rest = this.rest(position); add(rest.left); add(rest.right);
    for (const direction of [1, -1] as const) {
      const plan = this.plan(position, direction);
      if (plan) { add(plan.staticLeft); add(plan.front); add(plan.back); add(plan.under); }
    }
    return [...pages];
  }

  private get first(): number { return this.mode === "single" ? 1 : 0; }

  private forward(position: number): ComicTurnPlan | null {
    if (position + 1 >= this.positions + this.first) return null;
    if (this.mode === "single") {
      const front = this.page(position), under = this.page(position + 1);
      return front === null || under === null ? null : { staticLeft: null, front, back: null, under, reversed: false, target: position + 1 };
    }
    const rest = this.rest(position), front = rest.right, back = this.page(position * 2 + 2);
    if (front === null || back === null) return null;
    return { staticLeft: rest.left, front, back, under: this.page(position * 2 + 3), reversed: false, target: position + 1 };
  }

  private page(page: number): number | null { return page >= 1 && page <= this.totalPages ? page : null; }
}
