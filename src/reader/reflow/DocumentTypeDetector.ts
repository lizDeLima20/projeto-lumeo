import type { PDFDocumentProxy } from "pdfjs-dist";
export type DocumentType = "TEXT_BASED" | "IMAGE_BASED" | "MIXED";
export class DocumentTypeDetector {
  public async detect(document: PDFDocumentProxy): Promise<DocumentType> {
    const pages = [...new Set([1, Math.ceil(document.numPages / 2), document.numPages])]; const counts: number[] = [];
    for (const number of pages) { const content = await (await document.getPage(number)).getTextContent(); counts.push(content.items.reduce((sum, item) => sum + ("str" in item ? item.str.trim().length : 0), 0)); }
    const useful = counts.filter(count => count >= 40).length; if (useful === 0) return "IMAGE_BASED"; if (useful === counts.length) return "TEXT_BASED"; return "MIXED";
  }
}
