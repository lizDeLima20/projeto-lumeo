import type { ComicDocument, ComicPage, ComicTextRegion, NormalizedBounds } from "./ComicInteractionTypes";

export class ComicInteractionEngine {
  private pages: ComicPage[] | null = null;

  public open(document: ComicDocument): void {
    this.pages = [...document.pages];
  }

  /** A single page, ready before the rest of the comic is.
   *
   *  Converting a long comic takes minutes, and the reader is on one page of it. That page
   *  answers to a touch as soon as it is itself converted, without waiting for the pages
   *  before or after it; the finished package replaces these when it arrives. */
  public addPage(page: ComicPage): void {
    const pages = this.pages ?? (this.pages = []);
    const known = pages.findIndex(value => value.index === page.index);
    if (known >= 0) pages[known] = page; else pages.push(page);
  }

  public close(): void {
    this.pages = null;
  }

  public get isOpen(): boolean {
    return this.pages !== null;
  }

  public get hasInteractionData(): boolean {
    return Boolean(this.pages?.some(page => page.regions.length > 0));
  }

  public page(pageIndex: number): ComicPage | null {
    return this.pages?.find(page => page.index === pageIndex) ?? null;
  }

  public regionsForPage(pageIndex: number): readonly ComicTextRegion[] {
    return this.page(pageIndex)?.regions ?? [];
  }

  public hitTest(pageIndex: number, point: Pick<NormalizedBounds, "x" | "y">): ComicTextRegion | null {
    return this.regionsForPage(pageIndex).find(region => (
      point.x >= region.x &&
      point.x <= region.x + region.width &&
      point.y >= region.y &&
      point.y <= region.y + region.height
    )) ?? null;
  }
}
