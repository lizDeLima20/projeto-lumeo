export interface BookShelfCompactionProfile {
  visibleCoverRatio: number;
  overlapRatio: number;
  gapPixels: number;
}

export class BookShelfCompactionLayout {
  public static readonly edgePaddingPixels = 10;
  public static readonly startPaddingPixels = 10;
  public static readonly endPaddingPixels = 10;
  public static readonly bleedsToViewportEdges = true;
  /** A yawed volume paints only part of its flat width; boxes track that projection
   *  so the carousel does not end with dead wood after the last book. */
  public static readonly footprintRatio = .665;
  public static readonly trailingSlotTracksProjectedFootprint = true;
  /** Slots are wide enough to leave visible air between spines, and wide enough that
   *  the focused volume's lateral step cannot reach its neighbour. */
  public static readonly slotRemUnits = { mobile: 11.3, tablet: 12.5, desktop: 13.5 } as const;
  public static readonly focusLateralStepPixels = 12;
  public gapBetweenSpines(slotPixels: number, spinePixels: number, gapPixels = 4): number {
    return slotPixels * .42 + gapPixels - spinePixels;
  }
  public static readonly carouselSnapsAfterScroll = true;
  public static readonly snapType = "x proximity";
  public static readonly snapAlign = "start";
  public static readonly middleScrollCanClipAtEdges = true;
  public static readonly preservesBookDimensions = true;
  public resolve(renderedShelfBookCount: number, viewportWidth: number): BookShelfCompactionProfile {
    if(renderedShelfBookCount<2)return{visibleCoverRatio:.42,overlapRatio:.58,gapPixels:2};
    const visibleCoverRatio=viewportWidth<768?.34:viewportWidth<1024?.37:.4;
    return{visibleCoverRatio,overlapRatio:1-visibleCoverRatio,gapPixels:2};
  }

  public static keepsPositionWhileFocused = true;
}
