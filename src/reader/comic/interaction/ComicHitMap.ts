import type { ComicRect } from "../ComicLayout";
import type { ComicInteractionEngine } from "./ComicInteractionEngine";
import type { ComicTextRegion, NormalizedBounds } from "./ComicInteractionTypes";
import { comicRegionBounds } from "./ComicRegionBounds";

/** A page on screen: its index in the .lima (0-based) and where its artwork is drawn, in
 *  stage pixels - the contained art rect, never the slot or the screen. */
export interface ComicPageArt { pageIndex: number; rect: ComicRect; }

/** `source` is the container on screen: what the touch belongs to and what the enlarged
 *  balloon grows out of - the whole yellow box, not the words inside it. */
export interface ComicHit { region: ComicTextRegion; pageIndex: number; source: ComicRect; }

/** A finger is wider than a cursor: a touch this close to a region still means it. */
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

  /** The region under the point. Overlapping regions resolve to the one whose centre is
   *  nearest; a near miss within the slop still counts. */
  public hit(point: { x: number; y: number }): ComicHit | null {
    const located = this.locate(point); if (!located) return null;
    const page = this.pages.find(value => value.pageIndex === located.pageIndex)!;
    let best: { region: ComicTextRegion; distance: number } | null = null;
    for (const region of this.engine.regionsForPage(located.pageIndex)) {
      const rect = ComicHitMap.hitRect(page.rect, region);
      const inside = point.x >= rect.x - COMIC_HIT_SLOP_PX && point.x <= rect.x + rect.width + COMIC_HIT_SLOP_PX
        && point.y >= rect.y - COMIC_HIT_SLOP_PX && point.y <= rect.y + rect.height + COMIC_HIT_SLOP_PX;
      if (!inside) continue;
      const distance = Math.hypot(point.x - (rect.x + rect.width / 2), point.y - (rect.y + rect.height / 2));
      if (!best || distance < best.distance) best = { region, distance };
    }
    return best ? { region: best.region, pageIndex: located.pageIndex, source: ComicHitMap.visualRect(page.rect, best.region) } : null;
  }

  public regions(): { pageIndex: number; art: ComicRect; regions: readonly ComicTextRegion[] }[] {
    return this.pages.map(page => ({ pageIndex: page.pageIndex, art: page.rect, regions: this.engine.regionsForPage(page.pageIndex) }));
  }
}
