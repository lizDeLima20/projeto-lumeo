import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ReaderImmersive } from "../src/services/ReaderImmersive";

const source = (path: string): string => readFileSync(path, "utf8");

describe("HQ: a página ocupa a tela cheia do Android, sem tocar o leitor normal", () => {
  it("fora do Android não há plugin: nada é chamado", () => {
    assert.equal(ReaderImmersive.available, false);
  });

  it("o plugin nativo esconde as barras da própria janela do Lumeo, sem permissão de sistema, e devolve ao sair", () => {
    const plugin = source("android/app/src/main/java/com/lumeo/reader/ReaderImmersivePlugin.java");
    assert.match(plugin, /WindowCompat\.setDecorFitsSystemWindows\(window, !on\)/);
    assert.match(plugin, /controller\.hide\(WindowInsetsCompat\.Type\.systemBars\(\)\)/);
    assert.match(plugin, /controller\.show\(WindowInsetsCompat\.Type\.systemBars\(\)\)/);
    // A swipe from the edge must still reveal the bars - this is not a kiosk lockout.
    assert.match(plugin, /BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE/);
    assert.equal(/Settings\.System|SCREEN_BRIGHTNESS|WRITE_SETTINGS/.test(plugin), false, "nunca escreve uma preferência global do sistema");
    assert.match(plugin, /protected void handleOnResume\(\)/, "uma Activity recriada reaplica o estado");
    assert.match(plugin, /protected void handleOnDestroy\(\)[\s\S]*immersive = false;/, "a janela nunca fica presa no modo imersivo");
    const manifest = source("android/app/src/main/AndroidManifest.xml");
    assert.equal(manifest.includes("WRITE_SETTINGS"), false);
  });

  it("o plugin é registrado no MainActivity, ao lado dos outros plugins do leitor", () => {
    const activity = source("android/app/src/main/java/com/lumeo/reader/MainActivity.java");
    assert.match(activity, /registerPlugin\(ReaderImmersivePlugin\.class\)/);
  });

  it("o ComicReaderView entra em tela cheia ao abrir e devolve ao fechar", () => {
    const view = source("src/views/ComicReaderView.ts");
    assert.match(view, /import \{ ReaderImmersive \} from "\.\.\/services\/ReaderImmersive";/);
    assert.match(view, /void ReaderImmersive\.enter\(\);/);
    assert.match(view, /public override unmount\(\): void \{\s*this\.disposed = true;\s*void ReaderImmersive\.exit\(\);/);
  });

  it("o leitor normal de livros (PDF/EPUB) nunca é tocado por este plugin", () => {
    const reader = source("src/views/ReaderView.ts");
    assert.equal(reader.includes("ReaderImmersive"), false, "a tela cheia é exclusiva do leitor de HQ");
  });
});
