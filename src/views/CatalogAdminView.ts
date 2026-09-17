import type { TranslationKey } from "../i18n/I18nManager";
import { CatalogService, type CatalogGenreSource, type CatalogSourceReport, type CatalogSyncReport } from "../services/CatalogService";
import { I18nManager } from "../i18n/I18nManager";
import { BaseView } from "./BaseView";

/** Route is deliberately not in normal navigation; backend role still decides access. */
export class CatalogAdminView extends BaseView {
  private sourceList: HTMLElement | null = null;
  public constructor(private readonly catalog: CatalogService, private readonly onBack: () => void) { super(); }
  public render(): HTMLElement {
    const section = this.createElement("section", "catalog-admin page-shell"); const status = this.createElement("p", "catalog__status", this.t("ui.common.loading")); section.append(status); void this.load(section, status); return section;
  }
  private async load(section: HTMLElement, status: HTMLElement): Promise<void> {
    try {
      const access = await this.catalog.adminStatus(); if (!access.isAdmin) { status.textContent = this.t("ui.catalog.adminDenied"); return; }
      status.remove(); const title = this.createElement("h1", "page-title", this.t("ui.catalog.adminTitle")); const note = this.createElement("p", "page-subtitle", this.t("ui.catalog.adminHelp"));
      const sync = this.createElement("button", "button button--primary", this.t("ui.catalog.sync")); sync.type = "button"; const result = this.createElement("p", "catalog__status"); result.setAttribute("role", "status");
      const back = this.createElement("button", "link-button", this.t("ui.common.back")); back.type = "button"; back.addEventListener("click", this.onBack);
      sync.addEventListener("click", () => void this.sync(sync, result)); section.append(back, title, this.sourcesSection(), note, sync, result);
    } catch (error) { status.textContent = error instanceof Error ? error.message : this.t("ui.catalog.adminDenied"); }
  }

  /** "Fontes do catálogo": a genre is a name and a Drive folder link, nothing more. */
  private sourcesSection(): HTMLElement {
    const section = this.createElement("section", "catalog-sources"); section.setAttribute("aria-labelledby", "catalog-sources-title");
    const heading = this.createElement("h2", "catalog-sources__title", this.t("ui.catalog.sources.title")); heading.id = "catalog-sources-title";
    const help = this.createElement("p", "catalog-sources__help", this.t("ui.catalog.sources.help"));
    const add = this.createElement("button", "button button--primary catalog-sources__add", this.t("ui.catalog.sources.add")); add.type = "button";
    const formSlot = this.createElement("div", "catalog-sources__form-slot");
    add.addEventListener("click", () => { formSlot.replaceChildren(this.form(null, () => formSlot.replaceChildren())); formSlot.querySelector("input")?.focus(); });
    this.sourceList = this.createElement("div", "catalog-sources__list"); this.sourceList.setAttribute("aria-live", "polite");
    section.append(heading, help, add, formSlot, this.sourceList);
    void this.refreshSources();
    return section;
  }

  private async refreshSources(): Promise<void> {
    const list = this.sourceList; if (!list) return;
    list.replaceChildren(this.createElement("p", "catalog__status", this.t("ui.common.loading")));
    try {
      const sources = await this.catalog.sources();
      list.replaceChildren(...(sources.length ? sources.map((source) => this.sourceCard(source)) : [this.createElement("p", "catalog__status", this.t("ui.catalog.sources.empty"))]));
    } catch (error) { list.replaceChildren(this.createElement("p", "catalog__status", error instanceof Error ? error.message : this.t("ui.catalog.failed"))); }
  }

  private sourceCard(source: CatalogGenreSource): HTMLElement {
    const card = this.createElement("article", `catalog-source catalog-source--${source.report.status.toLowerCase()}`);
    const name = this.createElement("h3", "catalog-source__genre", source.genre);
    // A folder that could not be read has no count to show, rather than a misleading zero.
    const count = this.createElement("p", "catalog-source__count", source.report.inspection ? this.plural("ui.catalog.sources.books", source.report.inspection.validBooks) : "");
    const status = this.createElement("p", "catalog-source__status", this.statusLabel(source.report));
    const link = this.createElement("a", "catalog-source__link", source.driveFolderUrl); link.href = source.driveFolderUrl; link.target = "_blank"; link.rel = "noreferrer";
    const result = this.createElement("div", "catalog-source__result"); result.setAttribute("role", "status");
    const actions = this.createElement("div", "catalog-source__actions");
    const edit = this.button(this.t("ui.common.edit")), test = this.button(this.t("ui.catalog.sources.testShort")), remove = this.button(this.t("ui.catalog.sources.remove"));
    edit.addEventListener("click", () => card.replaceWith(this.form(source, () => void this.refreshSources())));
    test.addEventListener("click", () => void this.run(test, result, () => this.catalog.testSavedSource(source.id)));
    remove.addEventListener("click", () => void this.remove(source, remove, result));
    actions.append(edit, test, remove);
    card.dataset.sourceId = source.id; card.tabIndex = -1;
    // A folder that cannot be read says why on its own card, without a second click.
    if (["NO_ACCESS", "NO_CATALOG", "INVALID_CATALOG"].includes(source.report.status)) result.append(this.reportView(source.report));
    card.append(name, count, status, link, actions, result);
    return card;
  }

  private form(source: CatalogGenreSource | null, close: () => void): HTMLElement {
    const form = this.createElement("form", "catalog-source-form");
    const genre = this.field(form, this.t("ui.catalog.sources.genre"), "text", source?.genre ?? "");
    genre.maxLength = 80; genre.autocomplete = "off";
    const link = this.field(form, this.t("ui.catalog.sources.link"), "url", source?.driveFolderUrl ?? "");
    link.placeholder = "https://drive.google.com/drive/folders/…"; link.inputMode = "url";
    const enabledLabel = this.createElement("label", "catalog-source-form__toggle"); const enabled = this.createElement("input") as HTMLInputElement;
    enabled.type = "checkbox"; enabled.checked = source?.enabled ?? true; enabledLabel.append(enabled, document.createTextNode(this.t("ui.catalog.sources.enabled")));
    const result = this.createElement("div", "catalog-source__result"); result.setAttribute("role", "status");
    const actions = this.createElement("div", "catalog-source__actions");
    const save = this.createElement("button", "button button--primary", this.t("ui.common.save")); save.type = "submit";
    const test = this.button(this.t("ui.catalog.sources.test")), cancel = this.button(this.t("ui.common.cancel"));
    test.addEventListener("click", () => { if (this.valid(genre, link, result, false)) void this.run(test, result, () => this.catalog.testSource(link.value.trim(), genre.value.trim() || undefined)); });
    cancel.addEventListener("click", close);
    form.addEventListener("submit", (event) => { event.preventDefault(); if (this.valid(genre, link, result, true)) void this.save(source, { genre: genre.value.trim(), driveFolderUrl: link.value.trim(), enabled: enabled.checked }, save, result, close); });
    // The browser's own URL check would refuse links pasted without the scheme; the server validates.
    form.noValidate = true;
    actions.append(save, test, cancel); form.append(enabledLabel, actions, result);
    return form;
  }

  private async save(source: CatalogGenreSource | null, input: { genre: string; driveFolderUrl: string; enabled: boolean }, button: HTMLButtonElement, result: HTMLElement, close: () => void): Promise<void> {
    button.disabled = true; result.textContent = this.t("ui.catalog.sources.saving");
    try {
      const saved = source ? await this.catalog.updateSource(source.id, input) : await this.catalog.createSource(input);
      close(); await this.refreshSources();
      this.sourceList?.querySelector<HTMLElement>(`[data-source-id="${CSS.escape(saved.id)}"]`)?.focus();
    } catch (error) { result.textContent = error instanceof Error ? error.message : this.t("ui.catalog.failed"); }
    finally { button.disabled = false; }
  }

  private async remove(source: CatalogGenreSource, button: HTMLButtonElement, result: HTMLElement): Promise<void> {
    if (!window.confirm(this.t("ui.catalog.sources.removeConfirm", { genre: source.genre }))) return;
    button.disabled = true;
    try { await this.catalog.removeSource(source.id); await this.refreshSources(); }
    catch (error) { result.textContent = error instanceof Error ? error.message : this.t("ui.catalog.failed"); button.disabled = false; }
  }

  private async run(button: HTMLButtonElement, result: HTMLElement, test: () => Promise<CatalogSourceReport>): Promise<void> {
    button.disabled = true; result.textContent = this.t("ui.catalog.sources.testing");
    try { result.replaceChildren(this.reportView(await test())); }
    catch (error) { result.textContent = error instanceof Error ? error.message : this.t("ui.catalog.failed"); }
    finally { button.disabled = false; }
  }

  /** The folder test in plain lines: what was found, what counts, and the verdict. */
  private reportView(report: CatalogSourceReport): HTMLElement {
    const list = this.createElement("ul", `catalog-source-report catalog-source-report--${report.status.toLowerCase()}`);
    const line = (text: string): void => { list.append(this.createElement("li", "", text)); };
    if (report.status === "NO_ACCESS") line(this.t("ui.catalog.sources.noAccessHelp"));
    else if (report.status === "NO_CATALOG") { line(this.t("ui.catalog.sources.folderFound")); line(this.t("ui.catalog.sources.noCatalogHelp")); }
    else if (report.status === "INVALID_CATALOG") { line(this.t("ui.catalog.sources.folderFound")); line(this.t("ui.catalog.sources.invalidHelp")); }
    else if (report.inspection) {
      const value = report.inspection;
      line(this.t("ui.catalog.sources.folderFound")); line(this.t("ui.catalog.sources.catalogFound"));
      line(this.plural("ui.catalog.sources.validBooks", value.validBooks)); line(this.t("ui.catalog.sources.withSynopsis", { count: value.withSynopsis }));
      line(this.plural("ui.catalog.sources.validCovers", value.validCovers));
      if (value.mobiIgnored) line(this.plural("ui.catalog.sources.mobiIgnored", value.mobiIgnored));
    }
    line(this.t("ui.catalog.sources.statusLine", { status: this.statusLabel(report) }));
    return list;
  }

  private plural(key: TranslationKey, count: number): string { return I18nManager.shared.plural(key, count, { count }); }
  private statusLabel(report: CatalogSourceReport): string { return this.t(`ui.catalog.sources.status.${report.status}` as TranslationKey); }
  private valid(genre: HTMLInputElement, link: HTMLInputElement, result: HTMLElement, needsGenre: boolean): boolean {
    if ((needsGenre && !genre.value.trim()) || !link.value.trim()) { result.textContent = this.t("ui.catalog.sources.required"); return false; }
    return true;
  }
  private field(form: HTMLElement, label: string, type: string, value: string): HTMLInputElement {
    const wrapper = this.createElement("label", "catalog-source-form__field"); const input = this.createElement("input", "input") as HTMLInputElement;
    input.type = type; input.value = value; wrapper.append(this.createElement("span", "", label), input); form.append(wrapper); return input;
  }
  private button(text: string): HTMLButtonElement { const button = this.createElement("button", "button button--secondary", text); button.type = "button"; return button; }

  private async sync(button: HTMLButtonElement, result: HTMLElement): Promise<void> {
    button.disabled = true; result.textContent = this.t("ui.catalog.syncing");
    try { const report = await this.catalog.sync(); result.textContent = this.report(report); }
    catch (error) { result.textContent = error instanceof Error ? error.message : this.t("ui.catalog.failed"); }
    finally { button.disabled = false; }
  }
  private report(value: CatalogSyncReport): string { return this.t("ui.catalog.syncResult", { total: value.total, created: value.created, updated: value.updated, duplicates: value.duplicates, failures: value.failures }); }
}
