import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GoogleDriveApiProvider, CatalogDirectDownloadError } from "../src/services/GoogleDriveApiProvider";
import { GoogleDriveAuthorizationProvider } from "../src/services/GoogleDriveAuthorizationProvider";
import type { CatalogDownloadLink } from "../src/services/CatalogService";

const item = (overrides: Partial<CatalogDownloadLink> = {}): CatalogDownloadLink => ({
  bookId: "book-1", driveFileId: "1mftT_jgci_WcUvJkVyEXswchizAJHvgS", downloadUrl: "https://drive.google.com/unused", title: "Livro", author: "Autora", genreId: "sem-genero", genreName: "Sem gênero", format: "pdf", ...overrides,
});
const token = (reply: { access_token?: string; expires_in?: number; error?: string } = { access_token: "temporary", expires_in: 3600 }) => new GoogleDriveAuthorizationProvider("public-client", async () => reply);
const metadata = (value: object = {}) => new Response(JSON.stringify({ name: "Livro.pdf", mimeType: "application/pdf", capabilities: { canDownload: true }, ...value }), { status: 200, headers: { "content-type": "application/json" } });

describe("GoogleDriveApiProvider", () => {
  it("downloads a PDF through the official Drive API with an in-memory OAuth token", async () => {
    const calls: RequestInfo[] = []; const authorizations: string[] = []; const options: RequestInit[] = [];
    const provider = new GoogleDriveApiProvider(token(), async (input, init) => { calls.push(input); options.push(init ?? {}); authorizations.push(new Headers(init?.headers).get("Authorization") ?? ""); return calls.length === 1 ? metadata() : new Response("%PDF-1.7 bytes", { status: 200, headers: { "content-type": "application/pdf" } }); });
    const file = await provider.download(item(), () => undefined);
    assert.match(await file.text(), /^%PDF-/); assert.match(String(calls[0]), /fields=id,name/); assert.match(String(calls[1]), /alt=media/); assert.deepEqual(authorizations, ["Bearer temporary", "Bearer temporary"]);
    assert.deepEqual(options.map(({ method, mode, credentials, redirect, cache }) => ({ method, mode, credentials, redirect, cache })), [
      { method: "GET", mode: "cors", credentials: "omit", redirect: "follow", cache: "no-store" },
      { method: "GET", mode: "cors", credentials: "omit", redirect: "follow", cache: "no-store" },
    ]);
  });
  it("keeps a resource key in the official API request", async () => {
    let headers: Headers | undefined;
    const provider = new GoogleDriveApiProvider(token(), async (_input, init) => { headers = new Headers(init?.headers); return metadata(); });
    await assert.rejects(() => provider.download(item({ resourceKey: "resource-key" }), () => undefined), (error: unknown) => error instanceof CatalogDirectDownloadError && error.code === "GOOGLE_DRIVE_INVALID_FILE");
    assert.equal(headers?.get("X-Goog-Drive-Resource-Keys"), "1mftT_jgci_WcUvJkVyEXswchizAJHvgS/resource-key");
  });
  it("maps missing configuration, cancelled consent and denied consent without exposing credentials", async () => {
    await assert.rejects(() => new GoogleDriveApiProvider(new GoogleDriveAuthorizationProvider("")).download(item(), () => undefined), (error: unknown) => error instanceof CatalogDirectDownloadError && error.code === "GOOGLE_DRIVE_AUTH_NOT_CONFIGURED");
    await assert.rejects(() => new GoogleDriveApiProvider(token({ error: "popup_closed" })).download(item(), () => undefined), (error: unknown) => error instanceof CatalogDirectDownloadError && error.code === "GOOGLE_OAUTH_CANCELLED");
    await assert.rejects(() => new GoogleDriveApiProvider(token({ error: "access_denied" })).download(item(), () => undefined), (error: unknown) => error instanceof CatalogDirectDownloadError && error.code === "GOOGLE_OAUTH_ACCESS_DENIED");
  });
  it("maps Drive API status, capability, and unexpected HTML safely", async () => {
    const forbidden = new GoogleDriveApiProvider(token(), async () => new Response(JSON.stringify({ error: { errors: [{ reason: "insufficientPermissions" }] } }), { status: 403 }));
    await assert.rejects(() => forbidden.download(item(), () => undefined), (error: unknown) => error instanceof CatalogDirectDownloadError && error.code === "GOOGLE_DRIVE_INSUFFICIENT_PERMISSION");
    const blocked = new GoogleDriveApiProvider(token(), async () => metadata({ capabilities: { canDownload: false } }));
    await assert.rejects(() => blocked.download(item(), () => undefined), (error: unknown) => error instanceof CatalogDirectDownloadError && error.code === "GOOGLE_DRIVE_FILE_NOT_DOWNLOADABLE");
    let call = 0; const html = new GoogleDriveApiProvider(token(), async () => ++call === 1 ? metadata() : new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }));
    await assert.rejects(() => html.download(item(), () => undefined), (error: unknown) => error instanceof CatalogDirectDownloadError && error.code === "GOOGLE_DRIVE_HTML_RESPONSE");
  });
  it("accepts an EPUB ZIP signature through the same API import path", async () => {
    let call = 0; const epub = new GoogleDriveApiProvider(token(), async () => ++call === 1 ? metadata({ name: "Livro.epub", mimeType: "application/epub+zip" }) : new Response(new Uint8Array([0x50, 0x4b, 3, 4]), { status: 200, headers: { "content-type": "application/epub+zip" } }));
    const file = await epub.download(item({ format: "epub" }), () => undefined); assert.equal(file.type, "application/epub+zip");
  });
  it("maps token, file and network failures to actionable technical codes", async () => {
    const unauthorized = new GoogleDriveApiProvider(token(), async () => new Response("{}", { status: 401 }));
    await assert.rejects(() => unauthorized.download(item(), () => undefined), (error: unknown) => error instanceof CatalogDirectDownloadError && error.code === "GOOGLE_DRIVE_TOKEN_INVALID");
    const missing = new GoogleDriveApiProvider(token(), async () => new Response("{}", { status: 404 }));
    await assert.rejects(() => missing.download(item(), () => undefined), (error: unknown) => error instanceof CatalogDirectDownloadError && error.code === "GOOGLE_DRIVE_FILE_NOT_FOUND");
    const offline = new GoogleDriveApiProvider(token(), async () => { throw new TypeError("Failed to fetch"); });
    await assert.rejects(() => offline.download(item(), () => undefined), (error: unknown) => error instanceof CatalogDirectDownloadError && error.code === "DOWNLOAD_NETWORK_FAILED");
  });
});
