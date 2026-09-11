import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import type { MetadataSourceExtractor, NativeBookMetadata } from "./MetadataTypes";
export class PdfMetadataExtractor implements MetadataSourceExtractor {
  public constructor(private readonly loadDocument: (data: ArrayBuffer) => Promise<PDFDocumentLoadingTask> = PdfMetadataExtractor.open) {}
  private static async open(data: ArrayBuffer): Promise<PDFDocumentLoadingTask> {
    const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
    const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    GlobalWorkerOptions.workerSrc = workerUrl;
    return getDocument({ data });
  }
  public async extract(file: File): Promise<NativeBookMetadata> {
    const task = await this.loadDocument(await file.arrayBuffer());
    try { const pdf = await task.promise; const metadata = await pdf.getMetadata(); const info = metadata.info as Record<string, unknown>; const page = await pdf.getPage(1); const content = await page.getTextContent();
      // Image-only covers and scanned PDFs are valid imports. Metadata must
      // never wait for optional OCR, remote scripts or language downloads.
      const firstPageText = content.items.map(item => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("").replace(/[ \t]+/g, " ").trim();
      return { title: this.string(info.Title), author: this.string(info.Author), subject: this.string(info.Subject), keywords: this.string(info.Keywords), firstPageText };
    } finally { await task.destroy(); }
  }
  private string(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
}
