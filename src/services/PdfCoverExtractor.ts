import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export class PdfCoverExtractor {
  public static async extract(file: File): Promise<Blob> {
    const task = getDocument({ data: await file.arrayBuffer() });
    try {
      const document = await task.promise; const page = await document.getPage(1); const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 480 / base.width); const viewport = page.getViewport({ scale }); const canvas = window.document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width)); canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext("2d", { alpha: false }); if (!context) throw new Error("Canvas indisponível.");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      return new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Falha ao criar capa.")), "image/jpeg", .84));
    } finally { await task.destroy(); }
  }
}
