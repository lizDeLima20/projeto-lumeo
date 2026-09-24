import type { ComicTextRegion, NormalizedBounds } from "./ComicInteractionTypes";
import { comicRegionBounds } from "./ComicRegionBounds";

export type ComicReadingDirection = "ltr" | "rtl";

/** How much two regions must overlap vertically to count as the same row of the page. */
const ROW_OVERLAP = .38;

const centreY = (bounds: NormalizedBounds): number => bounds.y + bounds.height / 2;

/** The order the balloons of a page are most likely read in.
 *
 *  This is geometry, not interpretation: regions are grouped into rows by how much they
 *  overlap vertically - a row is what the eye takes in before it goes back to the left
 *  edge - and each row is then read across, left to right, or right to left for manga.
 *  Nothing is guessed from the words themselves and no model is asked to imagine an
 *  order; what is not evidence in the layout does not enter here.
 *
 *  A page whose panels defeat this - a diagonal splash, a spiral - simply gets a plausible
 *  order rather than a certain one, which is why the number is stored and can be corrected
 *  by hand later: a `readingOrder` already in the .lima is always kept. */
export function comicReadingOrder(regions: readonly ComicTextRegion[], direction: ComicReadingDirection = "ltr"): ComicTextRegion[] {
  const placed = regions.map(region => ({ region, bounds: comicRegionBounds(region).visual }));
  const byTop = [...placed].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);

  const rows: { top: number; bottom: number; members: typeof placed }[] = [];
  for (const entry of byTop) {
    const top = entry.bounds.y, bottom = entry.bounds.y + entry.bounds.height;
    const row = rows.at(-1);
    const overlap = row ? Math.min(row.bottom, bottom) - Math.max(row.top, top) : 0;
    if (row && overlap >= Math.min(row.bottom - row.top, entry.bounds.height) * ROW_OVERLAP) {
      row.members.push(entry);
      row.top = Math.min(row.top, top); row.bottom = Math.max(row.bottom, bottom);
    } else rows.push({ top, bottom, members: [entry] });
  }

  const across = direction === "rtl"
    ? (a: typeof placed[number], b: typeof placed[number]): number => (b.bounds.x + b.bounds.width) - (a.bounds.x + a.bounds.width) || a.bounds.y - b.bounds.y
    : (a: typeof placed[number], b: typeof placed[number]): number => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y;

  let order = 0;
  const numbered = new Map<string, number>();
  for (const row of rows) for (const entry of [...row.members].sort(across)) numbered.set(entry.region.id, ++order);
  return regions.map(region => ({ ...region, readingOrder: numbered.get(region.id) ?? 0 }));
}

/** The regions of a page in reading order.
 *
 *  A `readingOrder` written into the .lima wins, including one corrected by hand; regions
 *  without one fall in behind, ordered by where they sit on the page. */
export function comicReadingSequence<T extends ComicTextRegion>(regions: readonly T[]): T[] {
  return [...regions].sort((a, b) => {
    const left = a.readingOrder ?? Number.MAX_SAFE_INTEGER, right = b.readingOrder ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    const first = comicRegionBounds(a).visual, second = comicRegionBounds(b).visual;
    return centreY(first) - centreY(second) || first.x - second.x;
  });
}
