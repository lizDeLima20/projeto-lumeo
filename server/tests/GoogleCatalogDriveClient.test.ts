import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import { GoogleCatalogDriveClient } from "../src/catalog/GoogleCatalogDriveClient.js";

describe("GoogleCatalogDriveClient", () => {
  const accountJson = (): string => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    return JSON.stringify({ type: "service_account", project_id: "catalog-test", client_email: "catalog@example.iam.gserviceaccount.com", private_key: privateKey.export({ format: "pem", type: "pkcs8" }).toString() });
  };

  it("accepts the service-account formats preserved by Vercel without exposing its contents", () => {
    const json = accountJson();
    const accepts = (environmentValue: string): void => assert.doesNotThrow(() => new GoogleCatalogDriveClient(environmentValue, "root-folder", 1024));

    accepts(json);
    accepts(`\uFEFF${json}`);
    accepts(`\n  ${json}\n`);
    accepts(JSON.stringify(json));
    accepts(Buffer.from(json).toString("base64"));
    accepts(`GOOGLE_CATALOG_SERVICE_ACCOUNT_JSON=${json}`);
    // This mirrors an editor that turns the escaped newlines in private_key
    // into physical line breaks before Vercel supplies the environment value.
    accepts(json.replace(/\\n/g, "\n"));
  });

  it("reports structural input metadata and safe parse categories without credential contents", () => {
    const messages: string[] = [], original = console.info;
    console.info = (message: unknown): void => { messages.push(String(message)); };
    try {
      assert.throws(() => new GoogleCatalogDriveClient("not-json-or-base64", "root-folder", 1024), { code: "CATALOG_SERVICE_ACCOUNT_JSON_INVALID" });
      const shape = JSON.parse(messages[0] ?? "{}") as Record<string, unknown>;
      const input = JSON.parse(messages[1] ?? "{}") as Record<string, unknown>;
      assert.equal(shape.event, "CATALOG_SERVICE_ACCOUNT_SHAPE");
      assert.equal(shape.length, 18);
      assert.equal(shape.firstCharCode, 110);
      assert.equal(shape.lastCharCode, 52);
      assert.equal("private_key" in shape, false);
      const validation = JSON.parse(messages.at(-1) ?? "{}") as Record<string, unknown>;
      assert.deepEqual(input, {
        event: "CATALOG_SERVICE_ACCOUNT_INPUT", present: true, length: 18, format: "base64", firstCharType: "other", lastCharType: "other",
        leadingWhitespace: false, bom: false, outerQuote: false, doubleEncoded: false, base64: true, unexpectedPrefix: false, unexpectedSuffix: false,
      });
      assert.deepEqual(validation, { event: "CATALOG_SERVICE_ACCOUNT_VALIDATION", stage: "JSON.parse", outcome: "failed", reason: "base64_decode_failed" });
    } finally { console.info = original; }
  });

  it("classifies empty, malformed, and incorrectly wrapped environment values safely", () => {
    const json = accountJson();
    const cases: Array<{ value: string; code: string; reason: string }> = [
      { value: "", code: "CATALOG_SERVICE_ACCOUNT_MISSING", reason: "empty_value" },
      { value: json.slice(0, -3), code: "CATALOG_SERVICE_ACCOUNT_JSON_INVALID", reason: "invalid_json_syntax" },
      { value: `'${json}`, code: "CATALOG_SERVICE_ACCOUNT_JSON_INVALID", reason: "unexpected_wrapping" },
      { value: Buffer.from("not a json document").toString("base64"), code: "CATALOG_SERVICE_ACCOUNT_JSON_INVALID", reason: "base64_decode_failed" },
    ];
    const messages: string[] = [], original = console.info;
    console.info = (message: unknown): void => { messages.push(String(message)); };
    try {
      for (const test of cases) {
        assert.throws(() => new GoogleCatalogDriveClient(test.value, "root-folder", 1024), { code: test.code });
        const validation = JSON.parse(messages.at(-1) ?? "{}") as Record<string, unknown>;
        assert.equal(validation.reason, test.reason);
      }
    } finally { console.info = original; }
  });

  it("unwraps a copied environment assignment with spacing and outer quotes", () => {
    const json = accountJson();
    // Matches the production shape: an external `export NAME = '...'` wrapper
    // starts with a non-JSON character and ends with a quote.
    const copiedEnvironmentLine = ` \uFEFFexport GOOGLE_CATALOG_SERVICE_ACCOUNT_JSON = '${json}'`;
    const messages: string[] = [], original = console.info;
    console.info = (message: unknown): void => { messages.push(String(message)); };
    try {
      assert.doesNotThrow(() => new GoogleCatalogDriveClient(copiedEnvironmentLine, "root-folder", 1024));
      const input = JSON.parse(messages.find((message) => JSON.parse(message).event === "CATALOG_SERVICE_ACCOUNT_INPUT") ?? "{}") as Record<string, unknown>;
      assert.equal(input.format, "json_object");
      assert.equal(input.firstCharType, "other");
      assert.equal(input.lastCharType, "quote");
      assert.equal(input.leadingWhitespace, true);
      assert.equal(input.bom, true);
      assert.equal(input.outerQuote, true);
      assert.equal(input.unexpectedPrefix, true);
      assert.equal(input.unexpectedSuffix, false);
      const validationStages = messages.map((message) => JSON.parse(message) as Record<string, unknown>);
      assert.ok(validationStages.some((event) => event.stage === "JSON.parse" && event.outcome === "ok"));
      assert.ok(validationStages.some((event) => event.stage === "required_fields" && event.outcome === "ok"));
      assert.ok(validationStages.some((event) => event.stage === "private_key_format" && event.outcome === "ok"));
    } finally { console.info = original; }
  });

  it("reports positional shape data for every supported and wrapped transport form", () => {
    const json = accountJson();
    const cases: Array<{ name: string; value: string; succeeds: boolean }> = [
      { name: "BOM plus JSON", value: `\uFEFF${json}`, succeeds: true },
      { name: "whitespace plus JSON", value: ` \r\n${json}\r\n`, succeeds: true },
      { name: "prefix plus JSON", value: `prefix:${json}`, succeeds: false },
      { name: "JSON plus suffix", value: `${json}:suffix`, succeeds: false },
      { name: "prefix plus JSON plus suffix", value: `prefix:${json}:suffix`, succeeds: false },
      { name: "outer quotes", value: `'${json}'`, succeeds: true },
      { name: "double encoded", value: JSON.stringify(json), succeeds: true },
      { name: "base64", value: Buffer.from(json).toString("base64"), succeeds: true },
      { name: "literal private key newlines", value: json, succeeds: true },
      { name: "physical private key newlines", value: json.replace(/\\n/g, "\n"), succeeds: true },
    ];
    const original = console.info;
    try {
      for (const test of cases) {
        const messages: string[] = [];
        console.info = (message: unknown): void => { messages.push(String(message)); };
        if (test.succeeds) assert.doesNotThrow(() => new GoogleCatalogDriveClient(test.value, "root-folder", 1024), test.name);
        else assert.throws(() => new GoogleCatalogDriveClient(test.value, "root-folder", 1024), test.name);
        const shape = JSON.parse(messages[0] ?? "{}") as Record<string, unknown>;
        assert.equal(shape.event, "CATALOG_SERVICE_ACCOUNT_SHAPE", test.name);
        assert.equal(typeof shape.length, "number", test.name);
        assert.ok("firstOpeningBraceIndex" in shape, test.name);
        assert.ok("charactersAfterClosingBrace" in shape, test.name);
        assert.equal("client_email" in shape, false, test.name);
        assert.equal("private_key" in shape, false, test.name);
      }
    } finally { console.info = original; }
  });

  it("indexes every page, subfolder and shortcut without a UI-sized limit", async () => {
    const urls: URL[] = [];
    const client = new GoogleCatalogDriveClient(accountJson(), "root-folder", 1024, async (input) => {
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
