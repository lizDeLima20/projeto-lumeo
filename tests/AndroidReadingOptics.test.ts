import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("camada óptica nativa Android", () => {
  it("usa o sensor somente no Reader, com resposta logarítmica e proteção contra oscilações", async () => {
    const native = await readFile("android/app/src/main/java/com/lumeo/reader/ReadingOpticsPlugin.java", "utf8");
    assert.match(native, /Sensor\.TYPE_LIGHT/);
    assert.match(native, /Math\.log1p\(lux\)/);
    assert.match(native, /SMOOTHING = \.12f/);
    assert.match(native, /MIN_UPDATE_MS = 7_500L/);
    assert.match(native, /LOG_HYSTERESIS = \.16f/);
    assert.doesNotMatch(native, /Settings\.System\.put/);
  });

  it("aplica apenas papel e tinta das páginas reflow, sem filtro global de imagens ou HQs", async () => {
    const [view, css] = await Promise.all([
      readFile("src/views/ReaderView.ts", "utf8"),
      readFile("src/styles/reader.css", "utf8"),
    ]);
    assert.match(view, /AndroidReadingOptics\.start/);
    assert.match(view, /AndroidReadingOptics\.stop/);
    assert.match(css, /data-reading-optics="adaptive"/);
    assert.match(css, /\.reflow-sheet:not\(\.reflow-sheet--cover\)/);
    assert.doesNotMatch(css, /data-reading-optics="adaptive"[^}]*filter:/);
  });
});
