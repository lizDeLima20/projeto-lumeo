import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DesktopReaderGeometry } from "../src/reader/desktop/DesktopReaderGeometry";
import { readFileSync } from "node:fs";

describe("DesktopReaderGeometry", () => {
  const geometry = new DesktopReaderGeometry();

  it("mantém capa e página direita na mesma geometria nos viewports de desktop", () => {
    for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080]] as const) {
      const value = geometry.forViewport(width, height);
      assert.equal(value.spreadWidth, value.pageWidth * 2);
      assert.equal(value.spineX, value.pageWidth);
      assert.equal(value.pageWidth / value.pageHeight, DesktopReaderGeometry.pageRatio);
    }
  });

  it("não deixa a capa fechada criar uma página branca decorativa", () => {
    const source = readFileSync("src/reader/desktop/OpenBookLayout.ts", "utf8");
    assert.match(source, /coverState===\"open\"/);
    assert.match(source, /DesktopCoverState = "closed" \| "open"/);
    assert.match(source, /under-cover/);
  });

  it("cancela uma virada em blur ou quando a aba fica oculta", () => {
    const source = readFileSync("src/reader/desktop/PageTurnInteractionController.ts", "utf8");
    assert.match(source, /window\.addEventListener\("blur",\s*this\.cancel\)/);
    assert.match(source, /document\.addEventListener\("visibilitychange",\s*this\.visibility\)/);
  });
});
