import type { ComicPageBlocks } from "./ComicTextTypes";

/** Session cache: page 7 -> page 8 -> back to page 7 must not recognize page 7 again.
 *  Lives with the open comic and dies with it; nothing is written to storage in this stage. */
export class ComicPageBlockCache {
  private readonly values = new Map<number, ComicPageBlocks>();
  public constructor(private readonly limit = 12) {}
  public get(pageNumber: number): ComicPageBlocks | null { return this.values.get(pageNumber) ?? null; }
  public has(pageNumber: number): boolean { return this.values.has(pageNumber); }
  public set(value: ComicPageBlocks): void {
    this.values.delete(value.pageNumber); this.values.set(value.pageNumber, value);
    while (this.values.size > this.limit) { const oldest = this.values.keys().next().value; if (oldest === undefined) return; this.values.delete(oldest); }
  }
  public clear(): void { this.values.clear(); }
  public get size(): number { return this.values.size; }
}
