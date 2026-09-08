import { AppState } from "../core/AppState";
import { I18nManager, type SupportedLocale } from "../i18n/I18nManager";
import { Genre } from "../models/Genre";
import { BaseView } from "./BaseView";

const SUGGESTED_GENRES = ["Estudos", "ENEM", "Faculdade", "Romance", "Ficção", "Ficção Científica",
  "Suspense", "Terror", "História", "Biografia", "Negócios", "Desenvolvimento Pessoal", "Tecnologia", "Mangá", "Quadrinhos"] as const;
type GenreMode = "all" | "selected" | "custom";

export class OnboardingView extends BaseView {
  private readonly selected = new Set<string>();
  private readonly customGenres: Genre[] = [];
  private mode: GenreMode | null = null;
  private readonly i18n = I18nManager.shared;

  public constructor(private readonly state: AppState, private readonly userName: string, private readonly onComplete: () => void) { super(); }

  public render(): HTMLElement {
    const section = this.createElement("section", "onboarding page-shell");
    const intro = this.createElement("div", "onboarding__intro");
    intro.append(this.createElement("span", "eyebrow", "Seu espaço, do seu jeito"),
      this.createElement("h1", "page-title", `Olá, ${this.userName}!`),
      this.createElement("p", "onboarding__lead", "Vamos preparar seu ambiente de leitura?"));
    const panel = this.createElement("div", "setup-panel");
    panel.append(this.languageSelector(), this.createElement("div", "step-badge", "2"), this.createElement("h2", "setup-title", "Como quer organizar seus livros?"),
      this.createElement("p", "page-subtitle", "Você poderá alterar e criar novos gêneros depois."));
    const modes = this.createElement("div", "setup-options");
    modes.append(this.modeButton("all", "Quero todos os gêneros", "Começar com a seleção completa"),
      this.modeButton("selected", "Escolher meus gêneros", "Marcar apenas os que combinam comigo"),
      this.modeButton("custom", "Criar meus próprios", "Começar com categorias personalizadas"));
    const picker = this.createElement("details", "genre-picker");
    const checklist = this.createElement("div", "genre-checklist");
    SUGGESTED_GENRES.forEach((name) => checklist.append(this.genreCheckbox(name)));
    picker.append(this.createElement("summary", undefined, "Selecionar gêneros"), checklist);
    const selectedArea = this.createElement("div", "selected-area");
    selectedArea.append(this.createElement("span", "field__label", "Sua seleção"), this.createElement("div", "selected-genres"));
    const error = this.createElement("p", "form-error"); error.setAttribute("role", "alert");
    const complete = this.createElement("button", "button button--primary setup-complete", "Preparar minha biblioteca"); complete.type = "button";
    complete.addEventListener("click", () => this.complete(error));
    panel.append(modes, picker, selectedArea, this.customForm(), this.themeSelector(), error, complete);
    section.append(intro, panel); queueMicrotask(() => this.renderSelected()); return section;
  }

  private modeButton(mode: GenreMode, title: string, description: string): HTMLButtonElement {
    const button = this.createElement("button", "setup-option"); button.type = "button"; button.dataset.mode = mode;
    button.append(this.createElement("span", "setup-option__check"), this.createElement("strong", undefined, title), this.createElement("small", undefined, description));
    button.addEventListener("click", () => {
      this.mode = mode; this.markMode(mode);
      if (mode === "all") SUGGESTED_GENRES.forEach((name) => this.selected.add(name));
      if (mode === "custom") SUGGESTED_GENRES.forEach((name) => this.selected.delete(name));
      this.syncPicker(); this.renderSelected();
      if (mode === "selected") this.element?.querySelector<HTMLDetailsElement>(".genre-picker")?.setAttribute("open", "");
      if (mode === "custom") this.element?.querySelector<HTMLInputElement>("#custom-genre")?.focus();
    }); return button;
  }

  private genreCheckbox(name: string): HTMLLabelElement {
    const label = this.createElement("label", "genre-check"); const input = this.createElement("input") as HTMLInputElement;
    input.type = "checkbox"; input.value = name; input.addEventListener("change", () => {
      input.checked ? this.selected.add(name) : this.selected.delete(name); this.mode = "selected"; this.markMode("selected"); this.renderSelected();
    }); label.append(input, this.createElement("span", undefined, name)); return label;
  }

  private customForm(): HTMLFormElement {
    const form = this.createElement("form", "custom-genre-form"); const heading = this.createElement("div");
    heading.append(this.createElement("span", "field__label", "Gêneros personalizados"), this.createElement("p", "field-help", "Digite um nome e ele aparecerá na sua seleção."));
    const row = this.createElement("div", "inline-form"); const input = this.createElement("input", "input") as HTMLInputElement;
    input.id = "custom-genre"; input.placeholder = "Ex.: Poesia brasileira"; input.maxLength = 40;
    const create = this.createElement("button", "button button--secondary", "Adicionar"); create.type = "submit"; row.append(input, create); form.append(heading, row);
    form.addEventListener("submit", (event) => {
      event.preventDefault(); const name = input.value.trim(); if (!name || this.hasGenre(name)) return;
      this.customGenres.push(new Genre(crypto.randomUUID(), name)); this.selected.add(name); this.mode = "custom"; this.markMode("custom");
      input.value = ""; this.renderSelected(); input.focus();
    }); return form;
  }

  private themeSelector(): HTMLElement {
    const wrapper = this.createElement("div", "theme-setup");
    wrapper.append(this.createElement("div", "step-badge", "3"), this.createElement("h2", "setup-title", "Escolha a aparência"));
    const options = this.createElement("div", "theme-options");
    options.append(this.themeButton("light", "☀", "Tema claro"), this.themeButton("dark", "☾", "Tema escuro")); wrapper.append(options); return wrapper;
  }

  private themeButton(theme: "light" | "dark", icon: string, label: string): HTMLButtonElement {
    const button = this.createElement("button", `theme-choice${this.state.settings.theme === theme ? " theme-choice--active" : ""}`);
    button.type = "button"; button.dataset.theme = theme; button.append(this.createElement("span", "theme-choice__icon", icon), this.createElement("strong", undefined, label));
    button.addEventListener("click", () => {
      this.state.settings.theme = theme; document.documentElement.dataset.theme = theme;
      this.element?.querySelectorAll(".theme-choice").forEach((item) => item.classList.toggle("theme-choice--active", (item as HTMLElement).dataset.theme === theme));
    }); return button;
  }
  private languageSelector(): HTMLElement {
    const wrapper = this.createElement("label", "language-setup");
    wrapper.append(this.createElement("div", "step-badge", "1"), this.createElement("span", "field__label", this.i18n.t("onboarding.language")), this.createElement("p", "field-help", this.i18n.t("onboarding.languageHelp")));
    const select = this.createElement("select", "input") as HTMLSelectElement; select.setAttribute("aria-label", this.i18n.t("onboarding.language"));
    this.i18n.options().forEach(option => select.append(new Option(option.label, option.value))); select.value = this.i18n.locale;
    select.addEventListener("change", () => void this.i18n.setLocale(select.value as SupportedLocale)); wrapper.append(select); return wrapper;
  }

  private renderSelected(): void {
    const area = this.element?.querySelector<HTMLElement>(".selected-genres"); if (!area) return; area.replaceChildren();
    if (!this.selected.size) { area.append(this.createElement("span", "selection-empty", "Nenhum gênero selecionado ainda")); return; }
    this.selected.forEach((name) => {
      const chip = this.createElement("span", "selected-chip", name); const remove = this.createElement("button", undefined, "×"); remove.type = "button";
      remove.setAttribute("aria-label", `Remover ${name}`); remove.addEventListener("click", () => { this.selected.delete(name); this.syncPicker(); this.renderSelected(); });
      chip.append(remove); area.append(chip);
    });
  }

  private markMode(mode: GenreMode): void { this.element?.querySelectorAll(".setup-option").forEach((item) => item.classList.toggle("setup-option--active", (item as HTMLElement).dataset.mode === mode)); }
  private syncPicker(): void { this.element?.querySelectorAll<HTMLInputElement>(".genre-check input").forEach((input) => { input.checked = this.selected.has(input.value); }); }
  private hasGenre(name: string): boolean { return [...this.selected, ...SUGGESTED_GENRES].some((item) => item.toLocaleLowerCase() === name.toLocaleLowerCase()); }
  private complete(error: HTMLElement): void {
    if (!this.mode || !this.selected.size) { error.textContent = "Escolha pelo menos um gênero para continuar."; return; }
    const defaults = SUGGESTED_GENRES.filter((name) => this.selected.has(name)).map((name) => new Genre(this.slugify(name), name, new Date(), true));
    const custom = this.customGenres.filter((genre) => this.selected.has(genre.name));
    this.state.library.replaceGenres([...defaults, ...custom]); this.state.onboardingCompleted = true; this.state.notify(); this.onComplete();
  }
  private slugify(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, "-"); }
}
