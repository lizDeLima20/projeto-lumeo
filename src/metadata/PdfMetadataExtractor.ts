import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { MetadataSourceExtractor, NativeBookMetadata } from "./MetadataTypes";
GlobalWorkerOptions.workerSrc = workerUrl;
export class PdfMetadataExtractor implements MetadataSourceExtractor {
  public async extract(file: File): Promise<NativeBookMetadata> {
    const task = getDocument({ data: await file.arrayBuffer() });
    try { const pdf = await task.promise; const metadata = await pdf.getMetadata(); const info = metadata.info as Record<string, unknown>; const page = await pdf.getPage(1); const content = await page.getTextContent();
      let firstPageText = content.items.map(item => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("").replace(/[ \t]+/g, " ").trim();
      if (firstPageText.length < 20) firstPageText = await this.ocr(page);
      return { title: this.string(info.Title), author: this.string(info.Author), subject: this.string(info.Subject), keywords: this.string(info.Keywords), firstPageText };
    } finally { await task.destroy(); }
  }
  private async ocr(page: PDFPageProxy): Promise<string> {
    const viewport = page.getViewport({ scale: 1.5 }); const canvas = document.createElement("canvas"); canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d", { alpha: false }); if (!context) return ""; await page.render({ canvas, canvasContext: context, viewport }).promise;
    const { recognize } = await import("tesseract.js"); const result = await recognize(canvas, "por"); return result.data.text.replace(/\s+/g, " ").trim();
  }
  private string(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
}
