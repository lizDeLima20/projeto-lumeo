import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EN_US } from "../src/i18n/locales/en-US";
import { ES } from "../src/i18n/locales/es";
import { PT_BR } from "../src/i18n/locales/pt-BR";
import { DEFAULT_LOCALE, I18nManager, LocaleFormatter, LocaleRepository, TranslationDictionary, type SupportedLocale } from "../src/i18n/I18nManager";
import type { TranslationCatalog } from "../src/i18n/locales/pt-BR";
import type { StorageAdapter } from "../src/services/StorageService";

class MemoryStorage implements StorageAdapter {
  public readonly values = new Map<string, unknown>();
  public async load<T>(key: string): Promise<T | null> { return this.values.get(key) as T ?? null; }
  public async save<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
  public async remove(key: string): Promise<void> { this.values.delete(key); }
}

const create = (storage = new MemoryStorage()) => ({ storage, manager: new I18nManager(new LocaleRepository(storage), new TranslationDictionary(), new LocaleFormatter()) });
const keys = (catalog: object): string[] => Object.keys(catalog).sort();

describe("I18nManager", () => {
  it("registers exactly the initial supported locales", () => {
    const { manager } = create();
    assert.deepEqual(manager.getAvailableLocales(), ["pt-BR", "en-US", "es"]);
    assert.equal(DEFAULT_LOCALE, "pt-BR");
  });
  it("maps browser locale variants to the supported catalog", () => {
    const { manager } = create();
    assert.equal(manager.detect("pt-PT"), "pt-BR"); assert.equal(manager.detect("en-GB"), "en-US");
    assert.equal(manager.detect("es-MX"), "es"); assert.equal(manager.detect(["ja-JP", "en-GB"]), "en-US");
  });
  it("restores a saved manual locale before browser detection", async () => {
    const pair = create(); await pair.manager.setLocale("es");
    const restored = new I18nManager(new LocaleRepository(pair.storage), new TranslationDictionary(), new LocaleFormatter());
    assert.equal(await restored.initialize("en-GB"), "es");
  });
  it("falls back safely for unsupported stored locale", async () => {
    const storage = new MemoryStorage(); await storage.save("locale", "de"); const { manager } = create(storage);
    assert.equal(await manager.initialize("en-GB"), "en-US");
  });
  it("falls back to pt-BR when a non-base catalog misses a key", () => {
    const incomplete = { ...EN_US } as Record<string, string>; delete incomplete["reader.back"];
    const dictionary = new TranslationDictionary({ "pt-BR": PT_BR, "en-US": incomplete as TranslationCatalog, es: ES });
    assert.equal(dictionary.translate("en-US", "reader.back"), PT_BR["reader.back"]);
  });
  it("notifies runtime listeners and updates document language", async () => {
    const previous = (globalThis as { document?: unknown }).document, root = { lang: "" };
    Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: root, dispatchEvent: () => true } });
    try {
      const { manager } = create(); let seen: SupportedLocale | null = null;
      manager.subscribe(locale => { seen = locale; }); await manager.setLocale("en-US");
      assert.equal(seen, "en-US"); assert.equal(root.lang, "en-US");
    } finally { Object.defineProperty(globalThis, "document", { configurable: true, value: previous }); }
  });
  it("interpolates and pluralizes using locale rules", async () => {
    const { manager } = create();
    assert.equal(manager.t("format.pageOf", { current: 2, total: 10 }), "Página 2 de 10");
    assert.equal(manager.plural("format.books", 1), "1 livro"); assert.equal(manager.plural("format.books", 2), "2 livros");
    await manager.setLocale("en-US"); assert.equal(manager.plural("format.books", 2), "2 books");
  });
  it("translates the shared application chrome, reader and cloud-import copy", async () => {
    const { manager } = create(); await manager.setLocale("en-US");
    assert.equal(manager.t("ui.auth.login"), "Sign in"); assert.equal(manager.t("reader.animation.carousel"), "Vertical swipe");
    assert.equal(manager.t("import.download.cancel"), "Cancel download");
    await manager.setLocale("es");
    assert.equal(manager.t("ui.library.title"), "Mi biblioteca"); assert.equal(manager.t("reader.scan.scannedText"), "Texto escaneado");
    assert.equal(manager.t("import.remote.add"), "Añadir a la biblioteca");
  });
  it("centralizes locale-aware date, number, size and time formatting", () => {
    const formatter = new LocaleFormatter();
    assert.equal(formatter.number(1234.56, "pt-BR"), "1.234,56"); assert.equal(formatter.number(1234.56, "en-US"), "1,234.56");
    assert.match(formatter.date("2026-09-11T12:00:00.000Z", "en-US"), /9\/11\/2026/);
    assert.equal(formatter.fileSize(1_572_864, "en-US"), "1.5 MB"); assert.equal(formatter.duration(120, "es"), "2 horas");
  });
  it("keeps every base key in English and Spanish", () => {
    assert.deepEqual(keys(EN_US), keys(PT_BR)); assert.deepEqual(keys(ES), keys(PT_BR));
  });
});
