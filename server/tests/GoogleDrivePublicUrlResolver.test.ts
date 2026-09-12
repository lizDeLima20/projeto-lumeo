import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "../src/errors/ApiError.js";
import { GoogleDrivePublicUrlResolver } from "../src/catalog/GoogleDrivePublicUrlResolver.js";

describe("GoogleDrivePublicUrlResolver", () => {
  const resolver = new GoogleDrivePublicUrlResolver();
  it("normalizes a Drive file id into direct download and lightweight cover URLs", () => {
    const value = resolver.resolve("1mftT_jgci_WcUvJkVyEXswchizAJHvgS", "pdf");
    assert.equal(value.driveFileId, "1mftT_jgci_WcUvJkVyEXswchizAJHvgS");
    assert.match(value.downloadUrl, /^https:\/\/drive\.usercontent\.google\.com\/download\?.*export=download/);
    assert.match(value.coverUrl, /^https:\/\/drive\.google\.com\/thumbnail\?.*sz=w480-h640/);
  });
  it("extracts a file id from supported public Drive links", () => {
    assert.equal(resolver.extractFileId("https://drive.google.com/file/d/1mftT_jgci_WcUvJkVyEXswchizAJHvgS/view?usp=sharing"), "1mftT_jgci_WcUvJkVyEXswchizAJHvgS");
    assert.equal(resolver.extractFileId("https://drive.google.com/uc?export=download&id=1mftT_jgci_WcUvJkVyEXswchizAJHvgS"), "1mftT_jgci_WcUvJkVyEXswchizAJHvgS");
  });
  it("rejects unsupported file URLs instead of creating an unsafe direct link", () => {
    assert.throws(() => resolver.extractFileId("https://example.com/book.pdf"), (error: unknown) => error instanceof ApiError && error.code === "CATALOG_FILE_INVALID");
  });
});
