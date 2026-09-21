import { Util } from "pdfjs-dist";
import type { ComicPageSample, ComicTextFragmentSource } from "./ComicTextFragmentSource";
import type { ComicTextFragment, ComicTextSourceName } from "./ComicTextTypes";

/** Digital comics usually carry their lettering as real text. When they do, this is exact,
 *  instant, offline and free - which is why it runs before any OCR is considered. */
export class PdfTextLayerFragmentSource implements ComicTextFragmentSource {
  public readonly name: ComicTextSourceName = "pdf-text-layer";
  public async available(): Promise<boolean> { return true; }

  public async fragments(sample: ComicPageSample): Promise<ComicTextFragment[]> {
    const page = sample.page; if (!page) return [];
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const fragments: ComicTextFragment[] = [];
    content.items.forEach(item => {
      if (!("str" in item) || !item.str.trim()) return;
      const matrix = Util.transform(viewport.transform, item.transform) as number[];
      const fontHeight = Math.abs(item.height) > 0.5 ? Math.abs(item.height) : Math.hypot(matrix[2] ?? 0, matrix[3] ?? 0);
      const width = Math.abs(item.width) > 0.5 ? Math.abs(item.width) : item.str.length * fontHeight * 0.5;
      // The text matrix sits on the baseline; the visual box starts one cap height above it.
      const left = matrix[4] ?? 0, top = (matrix[5] ?? 0) - fontHeight;
      fragments.push({
        text: item.str.trim(),
        x: this.clamp(left / viewport.width), y: this.clamp(top / viewport.height),
        width: this.clamp(width / viewport.width), height: this.clamp(fontHeight / viewport.height),
      });
    });
    return fragments;
  }
  private clamp(value: number): number { return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0; }
}
