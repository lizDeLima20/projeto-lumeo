import type { ComicDocument, ComicPage, ComicTextRegion, NormalizedBounds } from "./ComicInteractionTypes";

export class ComicInteractionEngine {
  private document: ComicDocument | null = null;

  public open(document: ComicDocument): void {
    this.document = document;
  }

  public close(): void {
    this.document = null;
  }

  public get isOpen(): boolean {
    return this.document !== null;
  }

  public get hasInteractionData(): boolean {
    return Boolean(this.document?.pages.some(page => page.regions.length > 0));
  }

  public page(pageIndex: number): ComicPage | null {
    return this.document?.pages.find(page => page.index === pageIndex) ?? null;
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
