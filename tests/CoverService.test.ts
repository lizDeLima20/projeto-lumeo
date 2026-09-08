import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { strToU8, zipSync } from "fflate";
import { CoverService } from "../src/services/CoverService";

class TestFileReader {
  public result: string | ArrayBuffer | null = null; public onload: (() => void) | null = null; public onerror: (() => void) | null = null;
  public readAsDataURL(blob: Blob): void { void blob.arrayBuffer().then((buffer) => { this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`; this.onload?.(); }, () => this.onerror?.()); }
}
Object.assign(globalThis, { FileReader: TestFileReader });

describe("CoverService", () => {
  it("extrai a capa declarada no EPUB", async () => {
    const epub = zipSync({
      "META-INF/container.xml": strToU8('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
      "OEBPS/content.opf": strToU8('<package><manifest><item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/></manifest></package>'),
      "OEBPS/images/cover.png": new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    const cover = await new CoverService().fromBookFile(new File([new Uint8Array(epub).buffer], "book.epub", { type: "application/epub+zip" }), "epub", "Livro");
    assert.match(cover, /^data:image\/png;base64,/); assert.doesNotMatch(cover, /svg/);
  });
  it("gera placeholder elegante somente quando não há capa", async () => {
    const epub = zipSync({ "META-INF/container.xml": strToU8("<container/>") });
    const cover = await new CoverService().fromBookFile(new File([new Uint8Array(epub).buffer], "book.epub", { type: "application/epub+zip" }), "epub", "Grande Livro");
    assert.match(cover, /^data:image\/svg\+xml/); assert.match(decodeURIComponent(cover), />GL<\/text>/);
  });
});
