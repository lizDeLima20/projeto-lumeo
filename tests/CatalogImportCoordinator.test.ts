import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CatalogImportCoordinator, CatalogImportFileMismatchError } from "../src/services/CatalogImportCoordinator";
import type { CatalogDownloadLink } from "../src/services/CatalogService";

const bytes = (value: string): File => ({
  name: "Livro (1).pdf", size: new TextEncoder().encode(value).byteLength, type: "application/pdf",
  arrayBuffer: async () => new TextEncoder().encode(value).buffer,
} as File);

const link = (overrides: Partial<CatalogDownloadLink> = {}): CatalogDownloadLink => ({
  bookId: "catalog-1", driveFileId: "drive-1", downloadUrl: "https://drive.google.com/uc?id=drive-1",
  title: "Livro", author: "Autora", genreId: "romance", genreName: "Romance", format: "pdf",
  filename: "Livro.pdf", expectedFilename: "Livro.pdf", fileSize: 0, sha256: null, expiresAt: null, ...overrides,
});

const coordinator = (): { assertMatches(download: CatalogDownloadLink, file: File): Promise<void> } =>
  new CatalogImportCoordinator({} as never, {} as never) as unknown as { assertMatches(download: CatalogDownloadLink, file: File): Promise<void> };

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

describe("CatalogImportCoordinator content identity", () => {
  it("accepts a browser-renamed copy when its SHA-256 and size match the catalogue", async () => {
    const file = bytes("%PDF-correct");
    await coordinator().assertMatches(link({ fileSize: file.size, sha256: await sha256("%PDF-correct") }), file);
  });

  it("rejects another PDF even when its filename matches the expected catalogue name", async () => {
    const file = { ...bytes("%PDF-other"), name: "Livro.pdf" } as File;
    await assert.rejects(() => coordinator().assertMatches(link({ fileSize: file.size, sha256: "0".repeat(64) }), file), CatalogImportFileMismatchError);
  });

  it("uses the browser collision suffix only as a legacy fallback when no checksum exists", async () => {
    const file = bytes("%PDF-legacy");
    await coordinator().assertMatches(link({ fileSize: file.size, sha256: null }), file);
  });

  it("rejects a size mismatch before accepting a legacy filename fallback", async () => {
    const file = bytes("%PDF-legacy");
    await assert.rejects(() => coordinator().assertMatches(link({ fileSize: file.size + 1, sha256: null }), file), CatalogImportFileMismatchError);
  });
});
