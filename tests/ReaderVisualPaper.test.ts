import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("apresentação visual de papel", () => {
  it("usa papel levemente quente e tinta confortável sem adicionar uma textura falsa", async () => {
    const css = await readFile("src/styles/reader.css", "utf8");
    assert.match(css, /data-paper="paper"\]\{--reader-paper:#f5f3eb;--reader-ink:#292824/);
    assert.match(css, /text-rendering:optimizeLegibility/);
    assert.match(css, /font-synthesis:none/);
    assert.doesNotMatch(css, /paper-texture|noise\.png|grain\.png/);
  });

  it("mantém a arte de HQ sem filtros de cor e suaviza somente o palco externo", async () => {
    const css = await readFile("src/styles/comic.css", "utf8");
    // The stage around the page follows the theme; the page itself is drawn untouched.
    assert.match(css, /\.comic-reader \{[^}]*--comic-stage: #141412/);
    assert.match(css, /\.comic-reader\[data-reader-theme="light"\] \{ --comic-stage: #ebe7de/);
    assert.doesNotMatch(css, /\.comic-canvas[^}]*filter:/);
    const renderer = await readFile("src/reader/comic/ComicTurnRenderer.ts", "utf8");
    assert.doesNotMatch(renderer, /\.filter\s*=/);
  });

  it("mantém texto e campos do painel de leitura em contraste correto nos dois fundos", async () => {
    const css = await readFile("src/styles/reader.css", "utf8");
    assert.match(css, /--reader-settings-field:#fffefa;--reader-settings-ink:#24211d/);
    assert.match(css, /\.reader-settings :is\(input[^}]*color:var\(--reader-settings-ink\);background:var\(--reader-settings-field\)/);
    assert.match(css, /data-paper="dark"\] \.reader-settings\{--reader-settings-surface:#211f1b;--reader-settings-field:#151411;--reader-settings-ink:#f2ede2/);
  });
});
