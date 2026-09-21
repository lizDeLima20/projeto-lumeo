import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ReaderDisplay } from "../src/services/ReaderDisplay";
import { ReaderPreferencesService } from "../src/reader/settings/ReaderPreferencesService";
import type { StorageAdapter } from "../src/services/StorageService";

const memory = (): StorageAdapter & { values: Map<string, unknown> } => {
  const values = new Map<string, unknown>();
  return { values, load: async <T>(key: string) => (values.get(key) as T) ?? null, save: async (key, value) => { values.set(key, value); }, remove: async (key) => { values.delete(key); } };
};

describe("Leitura no Android como e-reader", () => {
  it("o brilho de leitura vai de 2% a 100% da janela e nunca sai dessa faixa", () => {
    assert.equal(ReaderDisplay.level(2), 0.02);
    assert.equal(ReaderDisplay.level(0), 0.02);
    assert.equal(ReaderDisplay.level(60), 0.6);
    assert.equal(ReaderDisplay.level(150), 1);
    assert.equal(ReaderDisplay.available, false, "fora do Android não há plugin: nada é chamado");
  });

  it("o brilho é da janela do Lumeo, sem permissão de sistema, e é restaurado", () => {
    const plugin = readFileSync("android/app/src/main/java/com/lumeo/reader/ReaderDisplayPlugin.java", "utf8");
    const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
    const activity = readFileSync("android/app/src/main/java/com/lumeo/reader/MainActivity.java", "utf8");
    assert.match(plugin, /params\.screenBrightness = level == null \? WindowManager\.LayoutParams\.BRIGHTNESS_OVERRIDE_NONE : level/);
    assert.equal(/Settings\.System|SCREEN_BRIGHTNESS/.test(plugin), false, "nunca escreve o brilho global");
    assert.equal(manifest.includes("WRITE_SETTINGS"), false);
    assert.match(plugin, /MIN_BRIGHTNESS = 0\.02f/);
    assert.match(plugin, /protected void handleOnResume\(\)/);
    assert.match(activity, /registerPlugin\(ReaderDisplayPlugin\.class\)/);
    const reader = readFileSync("src/views/ReaderView.ts", "utf8");
    assert.match(reader, /void ReaderDisplay\.apply\(preferences\.screenBrightness\)/);
    assert.match(reader, /this\.pomodoro=null;void ReaderDisplay\.restore\(\);/, "sair do leitor devolve o brilho do sistema");
  });

  it("no Android começa com Papel e Literata, e guarda as escolhas", async () => {
    const storage = memory();
    const android = new ReaderPreferencesService(storage, true);
    const first = await android.restorePreferences();
    assert.equal(first.paperTheme, "paper"); assert.equal(first.fontFamily, "book"); assert.equal(first.screenBrightness, null);
    await android.savePreferences({ paperTheme: "dark", screenBrightness: 1 });
    const restored = await new ReaderPreferencesService(storage, true).restorePreferences();
    assert.equal(restored.paperTheme, "dark"); assert.equal(restored.screenBrightness, 2, "abaixo do mínimo fica no mínimo");
    // An install from before keeps any real choice, but leaves Georgia/ivory once.
    const old = memory(); old.values.set("reader-preferences", { fontFamily: "classic", paperTheme: "ivory", fontSize: 21 });
    const migrated = await new ReaderPreferencesService(old, true).restorePreferences();
    assert.deepEqual([migrated.fontFamily, migrated.paperTheme, migrated.fontSize], ["book", "paper", 21]);
    const again = new ReaderPreferencesService(old, true); await again.restorePreferences(); await again.savePreferences({ fontFamily: "classic" });
    const reopened = await new ReaderPreferencesService(old, true).restorePreferences();
    assert.equal(reopened.fontFamily, "classic", "depois da migração, voltar para Clássica é respeitado");
    const chosen = memory(); chosen.values.set("reader-preferences", { fontFamily: "sans", paperTheme: "sepia" });
    const kept = await new ReaderPreferencesService(chosen, true).restorePreferences();
    assert.deepEqual([kept.fontFamily, kept.paperTheme], ["sans", "sepia"]);
    const web = await new ReaderPreferencesService(memory()).restorePreferences();
    assert.equal(web.paperTheme, "ivory"); assert.equal(web.fontFamily, "classic", "Web/Desktop mantêm os padrões atuais");
  });

  it("Papel, Claro, Sépia, Escuro: sem branco puro nem preto puro, em toda plataforma, e a capa intacta", () => {
    const css = readFileSync("src/styles/reader.css", "utf8");
    // Themes are unified across platforms: one .reader[data-paper="..."] rule, no
    // data-native="android" scoping - Web/Desktop get the same restrained palette.
    const theme = (name: string) => css.match(new RegExp(`\\.reader\\[data-paper="${name}"\\]\\{--reader-paper:(#[0-9a-f]{6});--reader-ink:(#[0-9a-f]{6});?\\}`))?.slice(1);
    for (const name of ["paper", "pure-white", "sepia", "dark"]) {
      const [paper, ink] = theme(name) ?? [];
      assert.ok(paper && ink, name);
      assert.notEqual(paper, "#ffffff"); assert.notEqual(paper, "#000000"); assert.notEqual(ink, "#000000"); assert.notEqual(ink, "#ffffff");
    }
    assert.equal(/data-native="android"\]\[data-paper=/.test(css), false, "os quatro temas não são mais duplicados só para o Android");
    assert.match(css, /--reader-paper-lit:var\(--reader-paper,#f5f3eb\)/, "o fundo da página segue o tema escolhido em qualquer plataforma");
    assert.match(css, /\.reader\[data-font="book"\]\{--reflow-font:"Literata Variable"/);
    assert.match(css, /\.reader\[data-native="android"\] \.reflow-sheet\{padding-left:calc\(max\(var\(--reflow-margin,28px\),\(100% - 34em\)\/2\)/);
    assert.equal(/data-native="android"[^{]*reader-cover-page/.test(css), false, "a capa segue com as próprias cores");
  });
});
