import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import { GoogleCatalogDriveClient } from "../src/catalog/GoogleCatalogDriveClient.js";

describe("GoogleCatalogDriveClient", () => {
  it("accepts the service-account formats preserved by Vercel without exposing its contents", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const account = { type: "service_account", project_id: "catalog-test", client_email: "catalog@example.iam.gserviceaccount.com", private_key: privateKey.export({ format: "pem", type: "pkcs8" }).toString() };
    const json = JSON.stringify(account);
    const accepts = (environmentValue: string): void => assert.doesNotThrow(() => new GoogleCatalogDriveClient(environmentValue, "root-folder", 1024));

    accepts(json);
    accepts(JSON.stringify(json));
    accepts(Buffer.from(json).toString("base64"));
    // This mirrors an editor that turns the escaped newlines in private_key
    // into physical line breaks before Vercel supplies the environment value.
    accepts(json.replace(/\\n/g, "\n"));
  });

  it("reports only the structural validation stage when service-account input is invalid", () => {
    const messages: string[] = [], original = console.info;
    console.info = (message: unknown): void => { messages.push(String(message)); };
    try {
      assert.throws(() => new GoogleCatalogDriveClient("not-json-or-base64", "root-folder", 1024), { code: "CATALOG_SERVICE_ACCOUNT_JSON_INVALID" });
      assert.deepEqual(JSON.parse(messages.at(-1) ?? "{}"), { event: "CATALOG_SERVICE_ACCOUNT_VALIDATION", stage: "JSON.parse" });
    } finally { console.info = original; }
  });

  it("indexes every page, subfolder and shortcut without a UI-sized limit", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 }); const urls: URL[] = [];
    const client = new GoogleCatalogDriveClient(JSON.stringify({ type: "service_account", project_id: "catalog-test", client_email: "catalog@example.iam.gserviceaccount.com", private_key: privateKey.export({ format: "pem", type: "pkcs8" }).toString() }), "root-folder", 1024, async (input) => {
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
