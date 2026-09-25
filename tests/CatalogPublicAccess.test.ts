import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ApiClient, ApiError } from "../src/services/ApiClient";
import { CatalogService } from "../src/services/CatalogService";

describe("catálogo público no WebView Android", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("consulta lista, detalhe e link sem Authorization mesmo se há token de conta", async () => {
    const api = new ApiClient("https://lumeo-livros.vercel.app/api");
    api.setAccessToken("account-access-token");
    const catalog = new CatalogService(api);
    const requests: { path: string; authorization: string | null }[] = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({ path: new URL(String(input)).pathname, authorization: new Headers(init?.headers).get("Authorization") });
      return Response.json({ items: [], nextCursor: null, bookId: "source:book" });
    }) as typeof fetch;
    await catalog.list();
    await catalog.get("source:book");
    await catalog.downloadLink("source:book");
    assert.deepEqual(requests.map(item => item.path), [
      "/api/catalog/books", "/api/catalog/books/source%3Abook", "/api/catalog/books/source%3Abook/download",
    ]);
    assert.ok(requests.every(item => item.authorization === null));
  });

  it("continua exigindo token para administração do catálogo", async () => {
    const catalog = new CatalogService(new ApiClient("https://lumeo-livros.vercel.app/api"));
    await assert.rejects(catalog.adminStatus(), (error: unknown) => error instanceof ApiError && error.code === "AUTH_REQUIRED");
  });

  it("sem internet informa erro de rede, não autenticação", async () => {
    const catalog = new CatalogService(new ApiClient("https://lumeo-livros.vercel.app/api"));
    globalThis.fetch = (async () => { throw new TypeError("offline"); }) as typeof fetch;
    await assert.rejects(catalog.list(), (error: unknown) => error instanceof ApiError && error.code === "NETWORK_ERROR");
  });
  it("converte respostas HTML 404/500 em erros controlados em vez de expor JSON.parse", async () => {
    const catalog = new CatalogService(new ApiClient("https://lumeo-livros.vercel.app/api"));
    for (const status of [404, 500]) {
      globalThis.fetch = (async () => new Response("<!doctype html><html><body>not found</body></html>", {
        status,
        statusText: status === 404 ? "Not Found" : "Internal Server Error",
        headers: { "content-type": "text/html; charset=utf-8" },
      })) as typeof fetch;
      await assert.rejects(catalog.list(), (error: unknown) => error instanceof ApiError
        && error.status === status
        && error.code === "API_NON_JSON_RESPONSE"
        && !error.message.includes("Unexpected token"));
    }
  });

  it("rejeita payload JSON servido com content-type text/html", async () => {
    const catalog = new CatalogService(new ApiClient("https://lumeo-livros.vercel.app/api"));
    globalThis.fetch = (async () => new Response(JSON.stringify({ items: [], nextCursor: null }), {
      status: 200,
      headers: { "content-type": "text/html" },
    })) as typeof fetch;
    await assert.rejects(catalog.list(), (error: unknown) => error instanceof ApiError
      && error.status === 200
      && error.code === "API_NON_JSON_RESPONSE");
  });

  it("mantém a bypass de /api no Service Worker para não responder JSON com cache de SPA", async () => {
    const { readFileSync } = await import("node:fs");
    const serviceWorker = readFileSync("public/sw.js", "utf8");
    const apiBypass = serviceWorker.indexOf('url.pathname.startsWith("/api/")');
    const runtimeCache = serviceWorker.indexOf('event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE))');
    assert.ok(apiBypass >= 0 && apiBypass < runtimeCache);
  });
});
