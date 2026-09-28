import { ComicArchiveSource } from "../ComicArchiveSource";
import { ComicConverter, type ComicConversionResult, type ComicConverterOptions } from "./ComicConverter";
import { comicSourceKey } from "./ComicConversionIdentity";
import { comicReadPageRegions } from "./ComicPageRegionReader";
import { ComicRegionOcr } from "./ComicRegionOcr";
import type { ComicPdfInput } from "./ComicPdfConverter";

/** Uses the same container detection, OCR, cutouts and LIMA package as PDF comics. */
export class ComicArchiveConverter {
  public constructor(private readonly format: "cbr" | "cbz", private readonly sharedSource?: ComicArchiveSource) {}

  public async convert(input: ComicPdfInput, options: ComicConverterOptions = {}): Promise<ComicConversionResult> {
    const source = this.sharedSource ?? new ComicArchiveSource(this.format);
    const ocr = new ComicRegionOcr();
    let canvas: HTMLCanvasElement | null = null;
    try {
      options.signal?.throwIfAborted();
      const key = await comicSourceKey(input.blob, input.coverPages ?? [0]);
      const count = this.sharedSource ? source.totalPages : await source.open(input.blob);
      return await new ComicConverter().convert({
        id: key, title: input.title, sourceFormat: this.format, sourceFileName: input.fileName,
        totalPages: count, conversionKey: key, priority: options.priority, onPageStarted: options.onPageStarted,
        pageProvider: async (index, signal) => {
          signal?.throwIfAborted();
          const image = await source.image(index + 1);
          const bitmap = await createImageBitmap(image);
          try {
            // Recognition has the same upper resolution as the PDF converter, while the
            // original page bytes remain untouched in the package and on the bookshelf.
            const scale = Math.min(1, 3072 / Math.max(bitmap.width, bitmap.height));
            canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
            if (!context) throw new Error("Canvas indisponível para HQ.");
            context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const bytes = new Uint8Array(await image.arrayBuffer());
            signal?.throwIfAborted();
            const extension = image.type === "image/jpeg" ? "jpg" : image.type === "image/png" ? "png" : "webp";
            return { path: `pages/${String(index + 1).padStart(3, "0")}.${extension}`, data: bytes,
              width: bitmap.width, height: bitmap.height, mimeType: image.type as "image/jpeg" | "image/png" | "image/webp",
              cover: (input.coverPages ?? [0]).includes(index) };
          } finally { bitmap.close(); }
        },
        regionProvider: async (index, asset, signal) => {
          if (!canvas) throw new Error("Página não renderizada.");
          asset.interactionAssets = [];
          return comicReadPageRegions(canvas, index, ocr, signal, input.contentType === "manga" ? "rtl" : "ltr", asset.interactionAssets, undefined, asset);
        },
        releasePage: () => { if (canvas) canvas.width = canvas.height = 0; canvas = null; },
      }, options);
    } finally { await ocr.dispose(); if (!this.sharedSource) await source.close(); }
  }
}
