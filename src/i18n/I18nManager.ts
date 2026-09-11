import { StorageService, type StorageAdapter } from "../services/StorageService";
import { EN_US } from "./locales/en-US";
import { ES } from "./locales/es";
import { PT_BR, type TranslationCatalog, type TranslationKey } from "./locales/pt-BR";
import { localizeLegacyInterface } from "./InterfaceLocalizer";

export { type TranslationKey } from "./locales/pt-BR";

export const SUPPORTED_LOCALES = ["pt-BR", "en-US", "es"] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];
export type TranslationParameters = Readonly<Record<string, string | number>>;
export const DEFAULT_LOCALE: SupportedLocale = "pt-BR";

const LOCALE_CATALOGS: Readonly<Record<SupportedLocale, TranslationCatalog>> = {
  "pt-BR": PT_BR,
  "en-US": EN_US,
  es: ES,
};

/** Technical codes stay stable; only their interface copy is localized. */
export const ERROR_CODE_TRANSLATION_KEYS = {
  AUTH_INVALID_CREDENTIALS: "error.auth.invalidCredentials",
  EPUB_INVALID: "error.epub.invalid",
  INDEXEDDB_SAVE_FAILED: "error.indexedDb.saveFailed",
  DOWNLOAD_FAILED: "error.download.failed",
  AUTH_REQUIRED: "error.auth.required",
  NETWORK_ERROR: "error.network",
  API_ERROR: "error.request",
  LICENSE_REQUIRED: "error.license.required",
} as const satisfies Readonly<Record<string, TranslationKey>>;

export class TranslationDictionary {
  public constructor(private readonly values: Readonly<Record<SupportedLocale, TranslationCatalog>> = LOCALE_CATALOGS) {}
  public translate(locale: SupportedLocale, key: string): string | undefined {
    return this.values[locale]?.[key as TranslationKey] ?? this.values[DEFAULT_LOCALE][key as TranslationKey];
  }
  public keys(locale: SupportedLocale): readonly string[] { return Object.keys(this.values[locale]); }
}

export class LocaleRepository {
  private static readonly KEY = "locale";
  public constructor(private readonly storage: StorageAdapter = new StorageService()) {}
  public load(): Promise<unknown | null> { return this.storage.load<unknown>(LocaleRepository.KEY); }
  public save(locale: SupportedLocale): Promise<void> { return this.storage.save(LocaleRepository.KEY, locale); }
}

/** Presentation formatting is centralized here; persisted values remain stable. */
export class LocaleFormatter {
  private readonly names: Readonly<Record<SupportedLocale, string>> = { "pt-BR": "Português (Brasil)", "en-US": "English", es: "Español" };
  public name(locale: SupportedLocale): string { return this.names[locale]; }
  public date(value: Date | string | number, locale: SupportedLocale, options?: Intl.DateTimeFormatOptions): string { return new Intl.DateTimeFormat(locale, options).format(new Date(value)); }
  public number(value: number, locale: SupportedLocale, options?: Intl.NumberFormatOptions): string { return new Intl.NumberFormat(locale, options).format(value); }
  public fileSize(bytes: number, locale: SupportedLocale): string {
    const safe = Math.max(0, bytes), units = ["B", "KB", "MB", "GB"] as const;
    const index = safe === 0 ? 0 : Math.min(units.length - 1, Math.floor(Math.log(safe) / Math.log(1024)));
    return `${this.number(safe / 1024 ** index, locale, { maximumFractionDigits: index === 0 ? 0 : 1 })} ${units[index]}`;
  }
  public duration(minutes: number, locale: SupportedLocale): string {
    const safe = Math.max(0, Math.round(minutes));
    if (safe < 60) return `${this.number(safe, locale)} min`;
    const hours = Math.round(safe / 60), unit = locale === "en-US" ? (hours === 1 ? "hour" : "hours") : `hora${hours === 1 ? "" : "s"}`;
    return `${this.number(hours, locale)} ${unit}`;
  }
}

type LocaleListener = (locale: SupportedLocale) => void;

export class I18nManager {
  public static readonly shared = new I18nManager(new LocaleRepository(), new TranslationDictionary(), new LocaleFormatter());
  private current: SupportedLocale = DEFAULT_LOCALE;
  private readonly listeners = new Set<LocaleListener>();
  private readonly missingKeys = new Set<string>();
  public constructor(private readonly repository: LocaleRepository, private readonly dictionary: TranslationDictionary, public readonly formatter: LocaleFormatter) {}
  public get locale(): SupportedLocale { return this.current; }
  public getLocale(): SupportedLocale { return this.current; }
  public getAvailableLocales(): readonly SupportedLocale[] { return SUPPORTED_LOCALES; }
  public async initialize(languages: string | readonly string[] | undefined = this.browserLanguages()): Promise<SupportedLocale> {
    const stored = await this.repository.load();
    this.current = this.isSupported(stored) ? stored : this.detect(languages);
    this.applyDocumentLanguage();
    return this.current;
  }
  public detect(languages?: string | readonly string[]): SupportedLocale {
    const candidates = typeof languages === "string" ? [languages] : languages ?? [];
    for (const candidate of candidates) {
      const normalized = candidate.trim();
      if (this.isSupported(normalized)) return normalized;
      const base = normalized.toLowerCase().split("-")[0];
      if (base === "pt") return "pt-BR";
      if (base === "en") return "en-US";
      if (base === "es") return "es";
    }
    return DEFAULT_LOCALE;
  }
  public t(key: TranslationKey, parameters?: TranslationParameters): string {
    const value = this.dictionary.translate(this.current, key);
    if (value === undefined) { this.logMissingKey(key); return key; }
    return this.interpolate(value, parameters);
  }
  /** Applies the reviewed compatibility catalogue to legacy DOM markup only. */
  public localizeTree(root: HTMLElement): void { localizeLegacyInterface(root, (key, parameters) => this.t(key, parameters)); }
  public plural(key: TranslationKey, count: number, parameters: TranslationParameters = {}): string {
    const [first = "", second] = this.t(key, { ...parameters, count }).split("|");
    const one = first, other = second ?? first;
    return new Intl.PluralRules(this.current).select(count) === "one" ? one : other;
  }
  public messageForErrorCode(code: string): string | null {
    const key = ERROR_CODE_TRANSLATION_KEYS[code as keyof typeof ERROR_CODE_TRANSLATION_KEYS];
    return key ? this.t(key) : null;
  }
  public options(): { value: SupportedLocale; label: string }[] { return this.getAvailableLocales().map(value => ({ value, label: this.formatter.name(value) })); }
  public async setLocale(locale: SupportedLocale): Promise<void> {
    if (!this.isSupported(locale)) return;
    const previous = this.current; this.current = locale; await this.repository.save(locale); this.applyDocumentLanguage(); this.logLocaleChanged(previous, locale);
    this.listeners.forEach(listener => listener(locale));
    if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent("lumeo:locale-change", { detail: { from: previous, to: locale } }));
  }
  public subscribe(listener: LocaleListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  public isSupported(value: unknown): value is SupportedLocale { return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value); }
  private browserLanguages(): readonly string[] { return typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]; }
  private interpolate(template: string, parameters: TranslationParameters = {}): string { return template.replace(/\{([\w.-]+)\}/g, (placeholder, name: string) => String(parameters[name] ?? placeholder)); }
  private applyDocumentLanguage(): void { if (typeof document !== "undefined") document.documentElement.lang = this.current; }
  private logLocaleChanged(from: SupportedLocale, to: SupportedLocale): void { if (this.isDevelopment()) console.info("I18N_LOCALE_CHANGED", { from, to }); }
  private logMissingKey(key: string): void { if (!this.isDevelopment() || this.missingKeys.has(key)) return; this.missingKeys.add(key); console.warn("I18N_MISSING_KEY", { key }); }
  private isDevelopment(): boolean { return Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV); }
}
