import { AppState } from "../core/AppState";
import { I18nManager, type SupportedLocale } from "../i18n/I18nManager";
import { BaseView } from "./BaseView";

export class OnboardingView extends BaseView {
  private readonly i18n = I18nManager.shared;

  public constructor(private readonly state: AppState, private readonly userName: string, private readonly onComplete: () => void) { super(); }

  public render(): HTMLElement {
    const section = this.createElement("section", "onboarding page-shell");
    const intro = this.createElement("div", "onboarding__intro");
    intro.append(this.createElement("span", "eyebrow", "Seu espaço, do seu jeito"),
      this.createElement("h1", "page-title", `Olá, ${this.userName}!`),
      this.createElement("p", "onboarding__lead", "Vamos preparar seu ambiente de leitura?"));
    const panel = this.createElement("div", "setup-panel");
    const complete = this.createElement("button", "button button--primary setup-complete", this.t("ui.onboarding.finish")); complete.type = "button";
    complete.addEventListener("click", () => this.complete());
    // Official genres are defined by the active catalogue sources. Personal
    // categories remain available while organizing a book in Biblioteca.
    panel.append(this.languageSelector(), this.themeSelector(), complete);
    section.append(intro, panel); return section;
  }

  private themeSelector(): HTMLElement {
    const wrapper = this.createElement("div", "theme-setup");
    wrapper.append(this.createElement("div", "step-badge", "2"), this.createElement("h2", "setup-title", this.t("ui.onboarding.appearance")));
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

  private complete(): void {
    this.state.onboardingCompleted = true; this.state.notify(); this.onComplete();
  }
}
