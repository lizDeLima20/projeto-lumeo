export type ComicLayoutMode = "single" | "spread";

export interface ComicRect { x: number; y: number; width: number; height: number; }
export interface ComicPageFit extends ComicRect {
  viewportAspectRatio: number;
  pageAspectRatio: number;
  scale: number;
  /** Reserved analysis hint; it never changes the visible bounds or crops the art. */
  contentBounds?: ComicRect;
}

/** The one geometry a comic is drawn with. REST, DRAG, ANIMATION, COMPLETE and CANCEL all
 *  read these same numbers, so a page can never change size when a gesture starts or ends.
 *
 *  Both modes share one shape: the page that turns sits to the right of `spineX`. On a
 *  phone that page IS the screen's page and there is no left slot; on the desktop the left
 *  slot mirrors it across the spine - an open book. */
export interface ComicGeometry {
  mode: ComicLayoutMode;
  width: number;
  height: number;
  spineX: number;
  top: number;
  pageWidth: number;
  pageHeight: number;
}

export interface ComicLayoutEnvironment { native: boolean; finePointer: boolean; }

/** Space the desktop spread leaves around the book: room for the Lumeo round buttons on
 *  top and the arrows at the sides, so the book is never a picture wall-to-wall. */
export const SPREAD_MARGINS = { top: 58, bottom: 26, side: 76 } as const;

export class ComicLayout {
  /** An open book only where there is a desk for it: a wide, landscape browser window
   *  driven by a mouse. The Android app, phones and tablets always read one page. */
  public static mode(width: number, height: number, environment: ComicLayoutEnvironment): ComicLayoutMode {
    return !environment.native && environment.finePointer && width >= 1024 && width > height ? "spread" : "single";
  }

  /** `aspect` is page width / page height, shared by the whole comic. */
  public static geometry(mode: ComicLayoutMode, width: number, height: number, aspect: number): ComicGeometry {
    const ratio = aspect > 0 && Number.isFinite(aspect) ? aspect : 2 / 3;
    if (mode === "single") {
      // Contain: the largest page of this proportion that fits; only the residue left by
      // the proportion itself is background.
      const [pageWidth, pageHeight] = ComicLayout.fit(width, height, ratio);
      return { mode, width, height, pageWidth, pageHeight,
        spineX: Math.round((width - pageWidth) / 2), top: Math.round((height - pageHeight) / 2) };
    }
    const availableWidth = Math.max(1, width - SPREAD_MARGINS.side * 2);
    const availableHeight = Math.max(1, height - SPREAD_MARGINS.top - SPREAD_MARGINS.bottom);
    const [pageWidth, pageHeight] = ComicLayout.fit(Math.floor(availableWidth / 2), availableHeight, ratio);
    return { mode, width, height, pageWidth, pageHeight, spineX: Math.round(width / 2),
      top: Math.round(SPREAD_MARGINS.top + (availableHeight - pageHeight) / 2) };
  }

  /** The side that limits keeps its full length; only the other one is derived. */
  private static fit(width: number, height: number, ratio: number): [number, number] {
    return width / height > ratio
      ? [Math.max(1, Math.round(height * ratio)), Math.max(1, Math.round(height))]
      : [Math.max(1, Math.round(width)), Math.max(1, Math.round(width / ratio))];
  }

  /** The slot a page occupies: "right" is the turning side in both modes. */
  public static slot(geometry: ComicGeometry, side: "left" | "right"): ComicRect {
    const x = side === "right" ? geometry.spineX : geometry.spineX - geometry.pageWidth;
    return { x, y: geometry.top, width: geometry.pageWidth, height: geometry.pageHeight };
  }

  /** Where a bitmap of `width x height` is drawn inside `slot`: contained, centred. A page
   *  whose proportions differ from the comic's is letterboxed, never stretched or cut. */
  public static contain(slot: ComicRect, width: number, height: number): ComicRect {
    if (!width || !height) return slot;
    return ComicLayout.presentationFit(slot, width, height);
  }

  public static presentationFit(slot: ComicRect, width: number, height: number, contentBounds?: ComicRect): ComicPageFit {
    const scale = Math.min(slot.width / width, slot.height / height);
    const drawnWidth = width * scale, drawnHeight = height * scale;
    return { x: slot.x + (slot.width - drawnWidth) / 2, y: slot.y + (slot.height - drawnHeight) / 2, width: drawnWidth, height: drawnHeight,
      viewportAspectRatio: slot.width / slot.height, pageAspectRatio: width / height, scale, contentBounds };
  }

  /** The comic's page proportion: the median of the sampled pages, so one odd page (a
   *  double splash, a cover with flaps) cannot resize the book for all the others. */
  public static aspect(samples: readonly number[]): number {
    const valid = samples.filter(value => value > 0 && Number.isFinite(value)).sort((a, b) => a - b);
    if (!valid.length) return 2 / 3;
    return valid[Math.floor((valid.length - 1) / 2)] ?? 2 / 3;
  }
}
