import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("política de privacidade", () => {
  it("mantém /privacy pública, fora do rodapé da página", async () => {
    const app = await readFile("src/core/App.ts", "utf8");
    const router = await readFile("src/core/Router.ts", "utf8");
    const view = await readFile("src/views/PrivacyView.ts", "utf8");
    assert.match(router, /"privacy"/);
    assert.match(app, /publicRoutes[^\n]+"privacy"/);
    assert.doesNotMatch(app, /href = "\/privacy"/);
    assert.match(view, /Última atualização: setembro de 2026/);
    assert.match(view, /não vende dados pessoais/);
  });
});
