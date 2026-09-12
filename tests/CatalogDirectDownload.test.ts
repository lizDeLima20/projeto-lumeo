import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CatalogDirectDownloadError, GoogleDrivePublicProvider } from "../src/services/GoogleDrivePublicProvider";
import type { CatalogDownloadLink } from "../src/services/CatalogService";

const item = (overrides: Partial<CatalogDownloadLink> = {}): CatalogDownloadLink => ({
  bookId: "book-1", driveFileId: "1mftT_jgci_WcUvJkVyEXswchizAJHvgS", downloadUrl: "https://drive.google.com/uc?export=download&id=1mftT_jgci_WcUvJkVyEXswchizAJHvgS",
  title: "Livro", author: "Autora", genreId: "sem-genero", genreName: "Sem gênero", format: "pdf", ...overrides,
});

async function withFetch(response: Response, action: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = async () => response;
  try { await action(); } finally { globalThis.fetch = original; }
}

describe("GoogleDrivePublicProvider", () => {
  it("accepts a real PDF signature returned as application/octet-stream", async () => {
    await withFetch(new Response("%PDF-1.7 real bytes", { status: 200, headers: { "content-type": "application/octet-stream" } }), async () => {
      const file = await new GoogleDrivePublicProvider().download(item(), () => undefined);
      assert.equal(file.type, "application/pdf"); assert.match(await file.text(), /^%PDF-/);
    });
  });
  it("rejects an HTML Drive confirmation page before it reaches ImportManager", async () => {
    await withFetch(new Response("<!doctype html><html>Drive</html>", { status: 200, headers: { "content-type": "text/html" } }), async () => {
      await assert.rejects(() => new GoogleDrivePublicProvider().download(item(), () => undefined), (error: unknown) => error instanceof CatalogDirectDownloadError && error.code === "GOOGLE_DRIVE_HTML_RESPONSE");
    });
  });
  it("maps public Drive access and availability responses to stable diagnostics", async () => {
    await withFetch(new Response("", { status: 403 }), async () => {
      await assert.rejects(() => new GoogleDrivePublicProvider().download(item(), () => undefined), (error: unknown) => error instanceof CatalogDirectDownloadError && error.code === "GOOGLE_DRIVE_ACCESS_DENIED");
    });
    await withFetch(new Response("", { status: 404 }), async () => {
      await assert.rejects(() => new GoogleDrivePublicProvider().download(item(), () => undefined), (error: unknown) => error instanceof CatalogDirectDownloadError && error.code === "GOOGLE_DRIVE_FILE_NOT_FOUND");
    });
  });
  it("uses a public fallback URL after a 403 without sending book bytes to the BFF", async () => {
    const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = async () => { calls++; return calls === 1 ? new Response("", { status: 403 }) : new Response("%PDF-1.7 fallback", { status: 200, headers: { "content-type": "application/octet-stream" } }); };
    try {
      const file = await new GoogleDrivePublicProvider().download(item({ downloadUrls: ["https://drive.usercontent.google.com/download?id=1mftT_jgci_WcUvJkVyEXswchizAJHvgS&export=download"] }), () => undefined);
      assert.equal(calls, 2); assert.match(await file.text(), /^%PDF-/);
    } finally { globalThis.fetch = original; }
  });
});
