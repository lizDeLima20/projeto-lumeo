import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import { GoogleCatalogDriveClient } from "../src/catalog/GoogleCatalogDriveClient.js";

describe("GoogleCatalogDriveClient", () => {
  it("indexes every page, subfolder and shortcut without a UI-sized limit", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 }); const urls: URL[] = [];
    const client = new GoogleCatalogDriveClient(JSON.stringify({ client_email: "catalog@example.iam.gserviceaccount.com", private_key: privateKey.export({ format: "pem", type: "pkcs8" }).toString() }), "root-folder", 1024, async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "oauth2.googleapis.com") return new Response(JSON.stringify({ access_token: "test", expires_in: 3600 }));
      urls.push(url); const parent = /'([^']+)' in parents/.exec(url.searchParams.get("q") ?? "")?.[1], token = url.searchParams.get("pageToken");
      if (parent === "root-folder" && !token) return json({ files: [file("folder-a", "Pasta", "application/vnd.google-apps.folder"), file("pdf-a", "A.pdf", "application/pdf"), { ...file("shortcut-a", "Atalho.pdf", "application/vnd.google-apps.shortcut"), shortcutDetails: { targetId: "pdf-a", targetMimeType: "application/pdf" } }], nextPageToken: "next" });
      if (parent === "root-folder") return json({ files: [file("epub-a", "B.epub", "application/epub+zip"), file("note", "nota.txt", "text/plain")] });
      return json({ files: [file("pdf-b", "C.pdf", "application/pdf")] });
    });
    const result = await client.listCatalog();
    assert.deepEqual(result.books.map((book) => book.id).sort(), ["epub-a", "pdf-a", "pdf-b"]);
    assert.deepEqual(result.audit, { foldersVisited: 2, pagesFetched: 3, rawItemsFound: 6, filesSeen: 6, supportedFiles: 4, pdfCount: 2, epubCount: 1, shortcutCount: 1, unsupportedCount: 1, duplicates: 1, parseFailures: 0, finalCatalogCount: 3 });
    assert.ok(urls.every((url) => url.searchParams.get("pageSize") === "1000" && url.searchParams.get("supportsAllDrives") === "true" && url.searchParams.get("includeItemsFromAllDrives") === "true"));
  });
});
function file(id: string, name: string, mimeType: string) { return { id, name, mimeType, modifiedTime: "2026-09-13T00:00:00.000Z" }; }
function json(value: unknown): Response { return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }); }
