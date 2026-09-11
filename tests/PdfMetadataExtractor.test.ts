import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import { PdfMetadataExtractor } from "../src/metadata/PdfMetadataExtractor";
import { BookMetadataExtractor } from "../src/metadata/BookMetadataExtractor";

function fixture(text: string, info: Record<string, string> = {}) {
  let destroyed = false;
  const task = {
    promise: Promise.resolve({
      getMetadata: async () => ({ info }),
      getPage: async () => ({
        getTextContent: async () => ({ items: text ? [{ str: text, hasEOL: false }] : [] }),
        render: () => { throw new Error("Metadata must not render a page for OCR"); },
      }),
    }),
    destroy: async () => { destroyed = true; },
  } as unknown as PDFDocumentLoadingTask;
  return { extractor: new PdfMetadataExtractor(async () => task), destroyed: () => destroyed };
}

describe("PDF metadata without mandatory OCR", () => {
  for (const text of ["", "Prefácio"]) {
    it(`accepts ${text ? "short text" : "an image-only first page"} without OCR`, async () => {
      const { extractor, destroyed } = fixture(text, { Title: "Livro", Author: "Autora" });
      const result = await extractor.extract(new File(["pdf"], "arquivo.pdf"));
      assert.equal(result.title, "Livro");
      assert.equal(result.author, "Autora");
      assert.equal(result.firstPageText, text);
      assert.equal(destroyed(), true);
    });
  }
  it("scanned PDF without metadata falls back to its filename", async () => {
    const { extractor } = fixture("");
    const result = await new BookMetadataExtractor().extract(new File(["pdf"], "meu_livro.pdf"), "pdf", extractor);
    assert.equal(result.title.value, "meu livro");
    assert.equal(result.title.confidence, "low");
    assert.equal(result.author, undefined);
  });
  it("preserves extracted text from textual PDFs", async () => {
    const { extractor } = fixture("Uma primeira página com conteúdo textual suficiente.");
    const result = await extractor.extract(new File(["pdf"], "livro.pdf"));
    assert.equal(result.firstPageText, "Uma primeira página com conteúdo textual suficiente.");
  });
});
