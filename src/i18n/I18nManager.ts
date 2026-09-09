import { StorageService, type StorageAdapter } from "../services/StorageService";
import { EXTERNAL_LIBRARY_PT, type ExternalLibraryTranslationKey } from "./ExternalLibraryTranslations";

export const SUPPORTED_LOCALES = ["pt-BR", "pt-PT", "en", "es-ES", "es-MX", "es-AR", "es-CO", "fr", "it", "de"] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];
export type TranslationKey =
  | ExternalLibraryTranslationKey
  | "reader.back" | "reader.pagePicker" | "reader.settings" | "reader.navigation" | "reader.notebook" | "reader.bookmark"
  | "reader.study" | "reader.previousPage" | "reader.nextPage" | "reader.toggleControls" | "reader.pdfPage"
  | "reader.loading" | "reader.closeSettings" | "reader.customization" | "reader.reading" | "reader.futureMarks"
  | "reader.text" | "reader.font" | "reader.font.classic" | "reader.font.modern" | "reader.font.sans" | "reader.font.accessible"
  | "reader.fontSize" | "reader.weight" | "reader.weight.light" | "reader.weight.normal" | "reader.weight.strong"
  | "reader.color" | "reader.color.softBlack" | "reader.color.graphite" | "reader.color.darkBrown" | "reader.color.nightBeige"
  | "reader.spacing" | "reader.spacing.compact" | "reader.spacing.normal" | "reader.spacing.comfortable" | "reader.spacing.wide"
  | "reader.paper" | "reader.background" | "reader.paper.pureWhite" | "reader.paper.ivory" | "reader.paper.softWhite" | "reader.paper.cream" | "reader.paper.natural" | "reader.paper.sepia" | "reader.paper.dark"
  | "reader.brightness" | "reader.bookReal" | "reader.bookReal.help" | "reader.layout" | "reader.pages" | "reader.onePage" | "reader.twoPages" | "reader.margins"
  | "reader.margin.narrow" | "reader.margin.normal" | "reader.margin.wide" | "reader.animation" | "reader.pageTurn"
  | "reader.animation.none" | "reader.animation.slide" | "reader.animation.pageTurn" | "reader.language"
  | "selection.actions" | "selection.highlight" | "selection.note" | "selection.dictionary" | "selection.origin"
  | "selection.search" | "selection.translate" | "selection.more" | "selection.context" | "selection.paragraph"
  | "selection.copy" | "selection.bookmark" | "selection.addToSheet" | "lookup.originNotFound" | "lookup.retry"
  | "onboarding.language" | "onboarding.languageHelp" | "settings.language" | "settings.languageHelp"
  | "reader.imageMode.notice" | "reader.imageMode.renderError" | "reader.scan.preset" | "reader.scan.original"
  | "reader.scan.scannedText" | "reader.scan.oldDocument" | "reader.scan.manga" | "reader.scan.blackWhite"
  | "reader.scan.highContrast" | "reader.scan.soft" | "reader.manga.mode" | "reader.manga.direction"
  | "reader.ocr.textUnavailable" | "reader.regionHighlight.markArea"
  | "reader.progress.label" | "reader.resume.continuing" | "reader.focus.enabled" | "reader.focus.disabled"
  | "reader.fullscreen.enter" | "reader.fullscreen.exit" | "reader.pagination.reflow" | "reader.pagination.original"
  | "pwa.install" | "offline.status" | "offline.reconnecting" | "offline.needsInternet" | "offline.bookRemoteOnly"
  | "storage.title" | "storage.checking" | "storage.used" | "storage.available" | "storage.books" | "storage.cache"
  | "storage.study" | "storage.preferences" | "storage.clearTemporary" | "storage.temporaryCleared" | "storage.lowSpace" | "storage.local" | "storage.persistent" | "backup.light"
  | "backup.full" | "recovery.repair" | "update.available" | "update.now" | "update.later"
  | "diagnostics.title" | "diagnostics.copy" | "recovery.startupFailed" | "recovery.startupFailedHelp"
  | "library.deleteBook" | "library.deleteConfirm" | "library.duplicateBook"
  | "library.versionConflict" | "library.versionPrompt" | "library.versionKeep" | "library.versionReplace" | "library.versionCancel";

type Dictionary = Record<TranslationKey, string>;

const PT_BR: Dictionary = {
  ...EXTERNAL_LIBRARY_PT,
  "reader.back": "Voltar para biblioteca", "reader.pagePicker": "Ir para uma página", "reader.settings": "Configurações de leitura",
  "reader.navigation": "Abrir sumário, busca e mapa", "reader.notebook": "Abrir Caderno", "reader.bookmark": "Marcar posição",
  "reader.study": "Abrir marcações", "reader.previousPage": "Página anterior", "reader.nextPage": "Próxima página",
  "reader.toggleControls": "Mostrar ou esconder controles", "reader.pdfPage": "Página do PDF", "reader.loading": "Preparando seu livro…",
  "reader.closeSettings": "Fechar configurações de leitura", "reader.customization": "Personalização da leitura",
  "reader.reading": "Leitura", "reader.futureMarks": "Marcações — em breve", "reader.text": "Texto", "reader.font": "Fonte",
  "reader.font.classic": "Clássica", "reader.font.modern": "Moderna", "reader.font.sans": "Limpa", "reader.font.accessible": "Alta legibilidade",
  "reader.fontSize": "Tamanho", "reader.weight": "Peso", "reader.weight.light": "Fina", "reader.weight.normal": "Normal",
  "reader.weight.strong": "Forte", "reader.color": "Cor", "reader.color.softBlack": "Preto suave", "reader.color.graphite": "Grafite",
  "reader.color.darkBrown": "Marrom", "reader.color.nightBeige": "Bege claro", "reader.spacing": "Espaçamento",
  "reader.spacing.compact": "Compacto", "reader.spacing.normal": "Normal", "reader.spacing.comfortable": "Confortável",
  "reader.spacing.wide": "Amplo", "reader.paper": "Papel", "reader.background": "Cor do papel", "reader.paper.pureWhite": "Branco puro",
  "reader.paper.ivory": "Marfim", "reader.paper.softWhite": "Branco suave",
  "reader.paper.cream": "Creme", "reader.paper.natural": "Natural", "reader.paper.sepia": "Sépia", "reader.paper.dark": "Escuro",
  "reader.brightness": "Iluminação da tela", "reader.bookReal": "Sem brilho / Livro Real",
  "reader.bookReal.help": "Simula papel/e-ink com vidro fumê visual, sem controlar o brilho físico do aparelho.",
  "reader.layout": "Layout", "reader.pages": "Páginas", "reader.onePage": "Uma página",
  "reader.twoPages": "Duas páginas", "reader.margins": "Margens", "reader.margin.narrow": "Estreita", "reader.margin.normal": "Normal",
  "reader.margin.wide": "Larga", "reader.animation": "Animação", "reader.pageTurn": "Virada de página",
  "reader.animation.none": "Nenhuma", "reader.animation.slide": "Deslizar", "reader.animation.pageTurn": "Folhear",
  "reader.language": "Idioma", "selection.actions": "Ações para o texto selecionado", "selection.highlight": "Grifar",
  "selection.note": "Nota", "selection.dictionary": "Significado", "selection.origin": "Origem", "selection.search": "Pesquisar",
  "selection.translate": "Traduzir", "selection.more": "Mais", "selection.context": "Contexto", "selection.paragraph": "Parágrafo",
  "selection.copy": "Copiar", "selection.bookmark": "Marcar trecho", "selection.addToSheet": "Adicionar ao fichário",
  "lookup.originNotFound": "Origem não encontrada.", "lookup.retry": "Tentar novamente", "onboarding.language": "Idioma",
  "onboarding.languageHelp": "Escolha o idioma principal da interface. Você pode trocar depois.",
  "settings.language": "Idioma", "settings.languageHelp": "Troque o idioma da interface sem sair da conta.",
  "reader.imageMode.notice": "Texto não disponível nesta página. Modo imagem local ativado.",
  "reader.imageMode.renderError": "Não foi possível renderizar esta página.",
  "reader.scan.preset": "Preset de imagem", "reader.scan.original": "Original", "reader.scan.scannedText": "Texto escaneado",
  "reader.scan.oldDocument": "Documento antigo", "reader.scan.manga": "Mangá", "reader.scan.blackWhite": "Preto e branco",
  "reader.scan.highContrast": "Contraste alto", "reader.scan.soft": "Suave", "reader.manga.mode": "Modo mangá",
  "reader.manga.direction": "Direção de leitura", "reader.ocr.textUnavailable": "Texto não reconhecido.",
  "reader.regionHighlight.markArea": "Marcar área",
  "reader.progress.label": "Progresso de leitura", "reader.resume.continuing": "Continuando de onde você parou",
  "reader.focus.enabled": "Modo foco ativado", "reader.focus.disabled": "Modo foco desativado",
  "reader.fullscreen.enter": "Entrar em tela cheia", "reader.fullscreen.exit": "Sair da tela cheia",
  "reader.pagination.reflow": "Reflow", "reader.pagination.original": "Página original",
  "pwa.install": "Instalar aplicativo", "offline.status": "Você está offline", "offline.reconnecting": "Reconectando…",
  "offline.needsInternet": "Esta ação precisa de internet.", "offline.bookRemoteOnly": "Este livro ainda não está disponível offline.",
  "storage.title": "Armazenamento", "storage.checking": "Verificando armazenamento…", "storage.used": "Usado",
  "storage.available": "Disponível estimado", "storage.books": "Livros", "storage.cache": "Cache temporário",
  "storage.study": "Notas e estudos", "storage.preferences": "Preferências", "storage.clearTemporary": "Limpar cache temporário",
  "storage.temporaryCleared": "Cache temporário limpo.", "storage.lowSpace": "Seu dispositivo está com pouco espaço disponível.",
  "storage.local": "Local", "storage.persistent": "Persistente", "backup.light": "Backup leve",
  "backup.full": "Backup completo", "recovery.repair": "Tentar reparar", "update.available": "Nova versão disponível",
  "update.now": "Atualizar agora", "update.later": "Depois", "diagnostics.title": "Diagnóstico",
  "diagnostics.copy": "Copiar diagnóstico", "recovery.startupFailed": "Não foi possível iniciar o Lumeo",
  "recovery.startupFailedHelp": "Tente recarregar. Se persistir, abra o diagnóstico ou use a recuperação local.",
  "library.deleteBook": "Excluir livro", "library.deleteConfirm": "Excluir este livro deste dispositivo? O arquivo, a capa, o progresso e os dados vinculados somente a ele serão removidos.",
  "library.duplicateBook": "Este livro já está na sua biblioteca.", "library.versionConflict": "Já existe outra versão deste livro na biblioteca.",
  "library.versionPrompt": "Já existe outra versão deste livro na biblioteca. Digite: manter, substituir ou cancelar.",
  "library.versionKeep": "manter", "library.versionReplace": "substituir", "library.versionCancel": "cancelar",
};

export class TranslationDictionary {
  private readonly values: Record<SupportedLocale, Dictionary> = Object.fromEntries(SUPPORTED_LOCALES.map(locale => [locale, PT_BR])) as Record<SupportedLocale, Dictionary>;
  public translate(locale: SupportedLocale, key: TranslationKey): string { return this.values[locale]?.[key] ?? PT_BR[key] ?? key; }
}

export class LocaleRepository {
  private static readonly KEY = "locale";
  public constructor(private readonly storage: StorageAdapter = new StorageService()) {}
  public load(): Promise<SupportedLocale | null> { return this.storage.load<SupportedLocale>(LocaleRepository.KEY); }
  public save(locale: SupportedLocale): Promise<void> { return this.storage.save(LocaleRepository.KEY, locale); }
}

export class LocaleFormatter {
  private readonly names: Record<SupportedLocale, string> = {
    "pt-BR": "Português (Brasil)", "pt-PT": "Português (Portugal)", en: "English", "es-ES": "Español (España)",
    "es-MX": "Español (México)", "es-AR": "Español (Argentina)", "es-CO": "Español (Colombia)", fr: "Français", it: "Italiano", de: "Deutsch",
  };
  public name(locale: SupportedLocale): string { return this.names[locale]; }
}

type LocaleListener = (locale: SupportedLocale) => void;

export class I18nManager {
  public static readonly shared = new I18nManager(new LocaleRepository(), new TranslationDictionary(), new LocaleFormatter());
  private current: SupportedLocale = "pt-BR";
  private readonly listeners = new Set<LocaleListener>();
  public constructor(private readonly repository: LocaleRepository, private readonly dictionary: TranslationDictionary, public readonly formatter: LocaleFormatter) {}
  public get locale(): SupportedLocale { return this.current; }
  public async initialize(language = globalThis.navigator?.language): Promise<SupportedLocale> {
    this.current = await this.repository.load() ?? this.detect(language); this.applyDocumentLanguage(); return this.current;
  }
  public detect(language?: string): SupportedLocale {
    if (this.isSupported(language)) return language;
    const base = language?.split("-")[0];
    return SUPPORTED_LOCALES.find(locale => locale.split("-")[0] === base) ?? "pt-BR";
  }
  public t(key: TranslationKey): string { return this.dictionary.translate(this.current, key); }
  public options(): { value: SupportedLocale; label: string }[] { return SUPPORTED_LOCALES.map(value => ({ value, label: this.formatter.name(value) })); }
  public async setLocale(locale: SupportedLocale): Promise<void> { this.current = locale; await this.repository.save(locale); this.applyDocumentLanguage(); this.listeners.forEach(listener => listener(locale)); }
  public subscribe(listener: LocaleListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  public isSupported(value: unknown): value is SupportedLocale { return typeof value === "string" && SUPPORTED_LOCALES.includes(value as SupportedLocale); }
  private applyDocumentLanguage(): void { if (globalThis.document?.documentElement) document.documentElement.lang = this.current; }
}
