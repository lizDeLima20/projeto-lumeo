/** Current page first, then the one the reader is about to turn to, then the one behind.
 *  Never the whole album: a long comic would spend minutes recognizing pages nobody opens. */
export class ComicPagePrefetchPlanner {
  public order(current: number, total: number): number[] {
    return [current, current + 1, current - 1].filter(page => page >= 1 && page <= total);
  }
}
