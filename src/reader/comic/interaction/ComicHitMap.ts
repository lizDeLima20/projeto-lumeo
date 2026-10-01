import type { ComicRect } from "../ComicLayout";
import type { ComicInteractionEngine } from "./ComicInteractionEngine";
import type { ComicTextRegion, NormalizedBounds } from "./ComicInteractionTypes";
import { comicRegionBounds } from "./ComicRegionBounds";
import { comicDistanceToBounds, comicDistanceToContour } from "./ComicSilhouette";

/** A page on screen: its index in the .lima (0-based) and where its artwork is drawn, in
 *  stage pixels - the contained art rect, never the slot or the screen. */
export interface ComicPageArt { pageIndex: number; rect: ComicRect; }

/** `source` is the container on screen: what the touch belongs to and what the enlarged
 *  balloon grows out of - the whole yellow box, not the words inside it. */
export interface ComicHit { region: ComicTextRegion; pageIndex: number; source: ComicRect; }

/** A finger is wider than a cursor: a touch this close to a region still means it. Kept
 *  small on purpose - a generous halo around a balloon is what let a big one answer for
 *  the small balloon beside it. */
export const COMIC_HIT_SLOP_PX = 6;

/** Android/iOS guidelines both converge near this as the smallest comfortable touch target,
 *  in stage pixels - the size a fingertip can land inside without needing precision. A
 *  balloon narrower than this in its own screen footprint is widened toward it below. */
const COMIC_COMFORTABLE_TOUCH_PX = 44;

/** How far a small balloon's own near-miss tolerance may grow, in stage pixels - well short
 *  of COMIC_COMFORTABLE_TOUCH_PX itself, so a cluster of tiny balloons standing close
 *  together still keeps each one's own separate touch rather than reaching into a neighbour
 *  that is also small. */
export const COMIC_SMALL_BALLOON_SLOP_PX = 16;

/** A region's own near-miss tolerance, in the same normalized page units `comicDistanceTo*`
 *  work in. A balloon with a comfortable screen footprint gets the flat COMIC_HIT_SLOP_PX;
 *  one smaller than a fingertip - the small balloon the detector found but a reader keeps
 *  missing - gets pulled up toward that comfortable size instead, capped at
 *  COMIC_SMALL_BALLOON_SLOP_PX. The visual region drawn on screen never changes size; only
 *  how close a touch has to land to still count as hitting it does. */
function regionSlop(hit: NormalizedBounds, art: ComicRect, scale: number): number {
  const smaller = Math.min(hit.width * art.width, hit.height * art.height);
  if (smaller >= COMIC_COMFORTABLE_TOUCH_PX) return COMIC_HIT_SLOP_PX / scale;
  const widened = COMIC_HIT_SLOP_PX + (COMIC_COMFORTABLE_TOUCH_PX - smaller) / 2;
  return Math.min(widened, COMIC_SMALL_BALLOON_SLOP_PX) / scale;
}

/** A grouped conversation's own halo, wider than one balloon's near-miss. The gap left
 *  between chained balloons after they are drawn is real empty page, not any one member's
 *  own edge, so it needs a tolerance of its own rather than a bigger COMIC_HIT_SLOP_PX -
 *  which would just as generously swallow whatever an independent object beside the group
 *  is standing on. Checked last, and only once nothing - group or not - already answered
 *  for the point, so a real object always keeps its own touch. */
export const COMIC_GROUP_HIT_SLOP_PX = 10;

/** Maps a point on the stage to the text region under it.
 *
 *  Regions are stored normalized (0..1) against their page. Everything is resolved against
 *  the page's real artwork rectangle, so margins around the page, the fitting scale, the
 *  orientation and the two pages of the open book all move the hit map with the art. */
export class ComicHitMap {
  public constructor(private readonly pages: readonly ComicPageArt[], private readonly engine: ComicInteractionEngine) {}

  public static regionRect(art: ComicRect, region: NormalizedBounds): ComicRect {
    return { x: art.x + region.x * art.width, y: art.y + region.y * art.height, width: region.width * art.width, height: region.height * art.height };
  }

  /** Where a region may be touched, on screen. */
  public static hitRect(art: ComicRect, region: ComicTextRegion): ComicRect {
    return ComicHitMap.regionRect(art, comicRegionBounds(region).hit);
  }

  /** The container itself, on screen: the balloon or box the balloon is enlarged from. */
  public static visualRect(art: ComicRect, region: ComicTextRegion): ComicRect {
    return ComicHitMap.regionRect(art, comicRegionBounds(region).visual);
  }

  /** The page whose artwork contains the point, and the point in that page's 0..1 space. */
  public locate(point: { x: number; y: number }): { pageIndex: number; x: number; y: number } | null {
    for (const page of this.pages) {
      const { x, y, width, height } = page.rect;
      if (width <= 0 || height <= 0) continue;
      if (point.x < x - COMIC_HIT_SLOP_PX || point.x > x + width + COMIC_HIT_SLOP_PX || point.y < y - COMIC_HIT_SLOP_PX || point.y > y + height + COMIC_HIT_SLOP_PX) continue;
      return { pageIndex: page.pageIndex, x: (point.x - x) / width, y: (point.y - y) / height };
    }
    return null;
  }

  /** The region under the point, decided by the outline the artist drew.
   *
   *  Three questions, in this order, and the first one that answers wins:
   *
   *    1. whose silhouette holds the point - a balloon lying inside another's rectangle is
   *       still its own balloon, and the point is in exactly one of the two outlines;
   *    2. whose rectangle holds it, smallest first - the small balloon beside a big group
   *       is not swallowed by the group's box;
   *    3. which outline the point is nearest to, within the slop - a near miss, and no
   *       more than that.
   *
   *  Nothing here prefers the bigger region, the first one written or the one already open.
   *  Two regions whose outlines both hold the point (a balloon drawn over another) go to
   *  the smaller one: it is the one the reader is pointing at. */
  public hit(point: { x: number; y: number }): ComicHit | null {
    const located = this.locate(point); if (!located) return null;
    const page = this.pages.find(value => value.pageIndex === located.pageIndex)!;
    const scale = Math.max(1, Math.min(page.rect.width, page.rect.height));
    let silhouette: { region: ComicTextRegion; area: number } | null = null;
    let boxed: { region: ComicTextRegion; area: number } | null = null;
    let nearest: { region: ComicTextRegion; distance: number } | null = null;
    for (const region of this.engine.regionsForPage(located.pageIndex)) {
      const bounds = comicRegionBounds(region);
      const area = bounds.hit.width * bounds.hit.height;
      const slop = regionSlop(bounds.hit, page.rect, scale);
      const outline = region.contour && region.contour.length >= 3 ? region.contour : null;
      if (outline) {
        // A balloon that knows its own shape is answered by that shape alone: the empty
        // page inside its rectangle - the gap between two lobes, the corner where the
        // next balloon sits - was never part of it.
        const distance = comicDistanceToContour(outline, located);
        if (distance === 0) { if (!silhouette || area < silhouette.area) silhouette = { region, area }; }
        else if (distance <= slop && (!nearest || distance < nearest.distance)) nearest = { region, distance };
        continue;
      }
      // Lettering with no container of its own - a caption in the open, a sound effect -
      // has only its rectangle, and the smallest one holding the point wins.
      const boxDistance = comicDistanceToBounds(bounds.hit, located);
      if (boxDistance === 0) { if (!boxed || area < boxed.area) boxed = { region, area }; }
      else if (boxDistance <= slop && (!nearest || boxDistance < nearest.distance)) nearest = { region, distance: boxDistance };
    }
    const chosen = silhouette?.region ?? boxed?.region ?? nearest?.region ?? null;
    if (chosen) return { region: chosen, pageIndex: located.pageIndex, source: ComicHitMap.visualRect(page.rect, chosen) };

    // Nothing answered for the point on its own terms. A grouped conversation still might,
    // within its own wider halo - the point is in the gap the artist actually left between
    // two of its balloons, not on an object of its own.
    const groupSlop = COMIC_GROUP_HIT_SLOP_PX / scale;
    let group: { region: ComicTextRegion; distance: number } | null = null;
    for (const region of this.engine.regionsForPage(located.pageIndex)) {
      if (!region.bubbleGroup) continue;
      const outline = region.contour && region.contour.length >= 3 ? region.contour : null;
      const distance = outline ? comicDistanceToContour(outline, located) : comicDistanceToBounds(comicRegionBounds(region).hit, located);
      if (distance <= groupSlop && (!group || distance < group.distance)) group = { region, distance };
    }
    return group ? { region: group.region, pageIndex: located.pageIndex, source: ComicHitMap.visualRect(page.rect, group.region) } : null;
  }

  public regions(): { pageIndex: number; art: ComicRect; regions: readonly ComicTextRegion[] }[] {
    return this.pages.map(page => ({ pageIndex: page.pageIndex, art: page.rect, regions: this.engine.regionsForPage(page.pageIndex) }));
  }
}
