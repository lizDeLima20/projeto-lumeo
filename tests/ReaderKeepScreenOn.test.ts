import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("tela ativa durante leitura Android", () => {
  it("usa somente a flag da janela, sem alterar o timeout global do aparelho", async () => {
    const native = await readFile("android/app/src/main/java/com/lumeo/reader/ReaderDisplayPlugin.java", "utf8");
    assert.match(native, /FLAG_KEEP_SCREEN_ON/);
    assert.match(native, /clearFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)/);
    assert.doesNotMatch(native, /SCREEN_OFF_TIMEOUT|Settings\.System\.put/);
  });

  it("mantém a tela ativa em livros e HQs, e restaura o sono ao fechar o Reader", async () => {
    const [reader, comic] = await Promise.all([
      readFile("src/views/ReaderView.ts", "utf8"),
      readFile("src/views/ComicReaderView.ts", "utf8"),
    ]);
    assert.match(reader, /ReaderDisplay\.keepAwake\(\)/);
    assert.match(reader, /ReaderDisplay\.allowSleep\(\)/);
    assert.match(comic, /ReaderDisplay\.keepAwake\(\)/);
    assert.match(comic, /ReaderDisplay\.allowSleep\(\)/);
  });
});
