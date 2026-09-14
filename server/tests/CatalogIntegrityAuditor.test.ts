import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { CatalogIntegrityAuditor } from "../src/catalog/CatalogIntegrityAuditor.js";
import type { CatalogDriveFile, CatalogDriveListing } from "../src/catalog/GoogleCatalogDriveClient.js";

const file = (id: string, name: string, size: number | null): CatalogDriveFile => ({ id, name, format: "pdf", mimeType: "application/pdf", size, modifiedAt: "2026-09-13T00:00:00.000Z" });
const listing = (books: readonly CatalogDriveFile[]): CatalogDriveListing => ({ books, audit: { foldersVisited: 1, pagesFetched: 1, rawItemsFound: books.length, filesSeen: books.length, supportedFiles: books.length, pdfCount: books.length, epubCount: 0, shortcutCount: 0, unsupportedCount: 0, duplicates: 0, parseFailures: 0, finalCatalogCount: books.length } });
const response = (body: string, status = 200): Response => new Response(body, { status, headers: { "content-type": "application/pdf" } });

describe("CatalogIntegrityAuditor", () => {
  it("reports valid content, unavailable files, and duplicate content without writing catalog data", async () => {
    const books = [file("file-one-123", "one.pdf", 12), file("file-missing-123", "missing.pdf", 12), file("file-duplicate-123", "duplicate.pdf", 12)];
    const checksum = createHash("sha256").update("%PDF-content").digest("hex");
    const drive = {
      listCatalog: async () => listing(books),
      hashAndValidate: async () => checksum,
    };
    const auditor = new CatalogIntegrityAuditor(drive as never, async (url) => {
      if (url.toString().includes("id=file-missing-123")) return response("not found", 404);
      return response("%PDF-content");
    });
    const report = await auditor.audit();
    assert.equal(report.totalFoundInSource, 3);
    assert.equal(report.totalNotFound, 1);
    assert.equal(report.totalDuplicates, 1);
    assert.deepEqual(report.entries.map((entry) => entry.status), ["OK", "FILE_NOT_FOUND", "DUPLICATE"]);
  });
});
