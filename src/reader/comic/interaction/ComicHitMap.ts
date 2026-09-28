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
    const slop = COMIC_HIT_SLOP_PX / scale;
    let silhouette: { region: ComicTextRegion; area: number } | null = null;
    let boxed: { region: ComicTextRegion; area: number } | null = null;
    let nearest: { region: ComicTextRegion; distance: number } | null = null;
    for (const region of this.engine.regionsForPage(located.pageIndex)) {
      const bounds = comicRegionBounds(region);
      const area = bounds.hit.width * bounds.hit.height;
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
    return chosen ? { region: chosen, pageIndex: located.pageIndex, source: ComicHitMap.visualRect(page.rect, chosen) } : null;
  }

  public regions(): { pageIndex: number; art: ComicRect; regions: readonly ComicTextRegion[] }[] {
    return this.pages.map(page => ({ pageIndex: page.pageIndex, art: page.rect, regions: this.engine.regionsForPage(page.pageIndex) }));
  }
}
