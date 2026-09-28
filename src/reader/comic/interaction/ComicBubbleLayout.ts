import type { ComicRect } from "../ComicLayout";
import type { ComicTextRegion } from "./ComicInteractionTypes";
import { comicRegionBounds } from "./ComicRegionBounds";

export interface ComicBubbleLayoutInput {
  /** The container on screen - the balloon or box as it is drawn on the page. */
  source: ComicRect;
  viewport: { width: number; height: number };
  /** Phones and narrow windows may use almost the full width. */
  compact: boolean;
  region?: ComicTextRegion;
  /** Bottom of the visible top controls, in layer coordinates. */
  safeTop?: number;
  /** The other balloons of the page, on screen: what the enlarged one should not sit on
   *  top of. They are avoided, never obeyed - a balloon always opens somewhere. */
  obstacles?: readonly ComicRect[];
}

export interface ComicBubbleTarget extends ComicRect {
  /** How much bigger than the artwork the balloon ended up. */
  zoom: number;
}

export const COMIC_BUBBLE_ZOOM = {
  /** The height a capital letter should reach on screen, in CSS pixels. Everything else
   *  follows from this: the smaller the lettering is on the page, the more it grows.
   *  A desktop is read at arm's length on a screen with room to spare, and seventeen
   *  pixels of capital left several balloons no bigger than they were on the page; the
   *  wide reading is twice that, and the screen still has the last word below. */
  capHeightPx: { compact: 15, wide: 34 },
  min: 1.15, max: 10,
  compact: { margin: 10, widthShare: .96, heightShare: .82 },
  wide: { margin: 20, widthShare: .78, heightShare: .88 },
} as const;

/** How tall a capital letter is inside this container, as a share of its height.
 *
 *  Two measurements agree on most containers: the one taken from the marks on the page and
 *  the one that follows from the recognized text and the box it sits in. Where they differ
 *  it is because something that is not lettering - the little drawing in the corner of a
 *  caption - stretched the first one, so the smaller of the two is the safer reading. */
export function comicCapShare(region: ComicTextRegion): number {
  const bounds = comicRegionBounds(region);
  if (bounds.visual.height <= 0) return .18;
  const lines = Math.max(1, region.text.trim().split(/\n+/).filter(Boolean).length);
  const fromText = bounds.text.height > 0 ? ((bounds.text.height / lines) * .72) / bounds.visual.height : 0;
  const measured = region.typography?.capHeight ? region.typography.capHeight / bounds.visual.height : 0;
  const readings = [fromText, measured].filter(value => value > .03 && value < .5);
  return readings.length > 0 ? Math.min(...readings) : .18;
}

/** How much to enlarge a container, from the size of its own lettering.
 *
 *  A fixed factor cannot serve both a caption the size of a stamp and a balloon that fills
 *  a panel: one stays unreadable and the other becomes a wall. What matters is the letters,
 *  so the measured cap height is taken to a comfortable reading size and the container
 *  comes along at whatever factor that needs - ten times for something tiny, barely one and
 *  a half for something already large. The screen then has the final word. */
export function comicBubbleZoom(source: ComicRect, viewport: { width: number; height: number }, compact: boolean, region?: ComicTextRegion): number {
  const capPx = Math.max(.5, (region ? comicCapShare(region) : .2) * source.height);
  const wanted = (compact ? COMIC_BUBBLE_ZOOM.capHeightPx.compact : COMIC_BUBBLE_ZOOM.capHeightPx.wide) / capPx;

  const limits = compact ? COMIC_BUBBLE_ZOOM.compact : COMIC_BUBBLE_ZOOM.wide;
  const margin = Math.min(limits.margin, viewport.width / 12);
  const maxWidth = Math.max(40, Math.min(viewport.width * limits.widthShare, viewport.width - margin * 2));
  const maxHeight = Math.max(40, Math.min(viewport.height * limits.heightShare, viewport.height - margin * 2));
  // The screen has the last word: a balloon that already fills the page simply stays put
  // rather than growing off the edge of it.
  const ceiling = Math.min(maxWidth / Math.max(1, source.width), maxHeight / Math.max(1, source.height));
  return Math.max(1, Math.min(Math.max(wanted, COMIC_BUBBLE_ZOOM.min), COMIC_BUBBLE_ZOOM.max, ceiling));
}

/** Where the enlarged balloon ends up: the same shape, simply bigger.
 *
 *  Both sides are scaled by one factor, so nothing is ever stretched, and the result is
 *  kept over its own artwork and inside the screen. Where the page has other balloons, the
 *  enlarged one steps aside rather than sitting on them: a balloon it covers completely is
 *  a balloon the reader cannot reach for, and no side is favoured in advance - left, right,
 *  up and down are all tried and the emptiest one wins. */
export function comicBubbleTarget(input: ComicBubbleLayoutInput): ComicBubbleTarget {
  const limits = input.compact ? COMIC_BUBBLE_ZOOM.compact : COMIC_BUBBLE_ZOOM.wide;
  const { width: viewportWidth, height: viewportHeight } = input.viewport;
  const margin = Math.min(limits.margin, viewportWidth / 12);
  const safeTop = Math.max(margin, Math.min(viewportHeight - margin - 1, input.safeTop ?? margin));
  const zoom = Math.max(1, Math.min(comicBubbleZoom(input.source, input.viewport, input.compact, input.region),
    (viewportHeight - safeTop - margin) / Math.max(1, input.source.height)));
  const width = input.source.width * zoom, height = input.source.height * zoom;

  // It grows out of its own place on the page, then steps inside the screen if it has to.
  const centreX = input.source.x + input.source.width / 2, centreY = input.source.y + input.source.height / 2;
  const inside = (value: number, span: number, limit: number): number =>
    Math.min(Math.max(margin, value), Math.max(margin, limit - margin - span));
  const insideY = (value: number): number => Math.min(Math.max(safeTop, value), Math.max(safeTop, viewportHeight - margin - height));
  const natural = { x: inside(centreX - width / 2, width, viewportWidth), y: insideY(centreY - height / 2) };
  const obstacles = (input.obstacles ?? []).filter(rect => rect.width > 0 && rect.height > 0);
  if (obstacles.length === 0) return { ...natural, width, height, zoom };

  // Obstacles may nudge the artwork, never relocate it to a distant empty corner.
  // Keep the adjustment bounded in each axis around the clamped original centre.
  const columns = [-8, 0, 8].map(offset => natural.x + offset);
  const rows = [-8, 0, 8].map(offset => natural.y + offset);
  let best = { ...natural, cost: Number.POSITIVE_INFINITY };
  for (const column of columns) for (const row of rows) {
    const place = { x: inside(column, width, viewportWidth), y: insideY(row) };
    const cost = covering({ ...place, width, height }, obstacles, input.source)
      // Among equally clear places, the one nearest where the balloon actually is.
      + Math.hypot(place.x - natural.x, place.y - natural.y) / Math.max(1, Math.hypot(viewportWidth, viewportHeight));
    if (cost < best.cost) best = { ...place, cost };
  }
  return { x: best.x, y: best.y, width, height, zoom };
}

/** How much of the other balloons a placement sits on: each one counted by the share of
 *  itself that is covered, one that disappears entirely counted several times over, and
 *  the balloons next to the one being opened counted heaviest of all.
 *
 *  A page read on a phone can be fuller than the screen, and then something is covered
 *  whatever is done. What must not be covered is the balloon right beside this one: that
 *  is the one the reader is about to reach for, and the one whose speech would otherwise
 *  look like it came out of the balloon on top of it. */
function covering(place: ComicRect, obstacles: readonly ComicRect[], source: ComicRect): number {
  const reach = Math.hypot(source.width, source.height);
  const centreX = source.x + source.width / 2, centreY = source.y + source.height / 2;
  let cost = 0;
  for (const rect of obstacles) {
    const overlapWidth = Math.max(0, Math.min(place.x + place.width, rect.x + rect.width) - Math.max(place.x, rect.x));
    const overlapHeight = Math.max(0, Math.min(place.y + place.height, rect.y + rect.height) - Math.max(place.y, rect.y));
    const share = (overlapWidth * overlapHeight) / Math.max(1, rect.width * rect.height);
    if (share === 0) continue;
    const distance = Math.hypot(rect.x + rect.width / 2 - centreX, rect.y + rect.height / 2 - centreY);
    const nearness = distance <= reach ? 2.5 : 1;
    cost += (share > .9 ? share * 4 : share) * nearness;
  }
  return cost;
}

/** The recognized text, reflowed for a wider balloon: single line breaks inside a sentence
 *  become spaces (a hyphenated break joins), blank lines between paragraphs stay. Nothing
 *  is corrected, completed or rewritten. */
export function comicBubbleText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim()
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.replace(/-\n\s*/g, "-").replace(/\s*\n\s*/g, " "))
    .join("\n\n");
}
