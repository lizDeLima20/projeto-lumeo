import type { AppState } from "../core/AppState";
import type { CatalogBookData } from "../models/CatalogBook";
import { Genre } from "../models/Genre";
import { I18nManager } from "../i18n/I18nManager";

/** Local confirmation before a catalogue file is committed to the library. */
export class CatalogGenreDialog {
  public constructor(private readonly state: AppState, private readonly book: CatalogBookData) {}

  public open(extractedCover = this.book.coverUrl ?? ""): Promise<CatalogBookData | null> {
    return new Promise((resolve) => {
      const i18n = I18nManager.shared;
      const overlay = document.createElement("div"); overlay.className = "catalog-genre-dialog";
      const dialog = document.createElement("section"); dialog.className = "catalog-genre-dialog__panel"; dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true");
      const heading = document.createElement("h2"); heading.textContent = i18n.t("ui.import.title");
      const details = document.createElement("div"); details.className = "catalog-genre-dialog__details";
      if (extractedCover) { const cover = document.createElement("img"); cover.className = "catalog-genre-dialog__cover"; cover.src = extractedCover; cover.alt = i18n.t("ui.catalog.coverOf", { title: this.book.title }); details.append(cover); }
      details.append(this.text("catalog-genre-dialog__format", `${i18n.t("ui.catalog.format")}: ${this.book.format.toUpperCase()}`));
      const title = this.field(i18n.t("ui.edit.bookTitle"), this.book.title, true);
      const author = this.field(i18n.t("ui.edit.author"), this.book.author, false);
      const label = document.createElement("label"); label.className = "field";
      const labelText = document.createElement("span"); labelText.className = "field__label"; labelText.textContent = i18n.t("ui.catalog.genre");
      const select = document.createElement("select"); select.className = "input";
      const seen = new Set<string>();
      const addOption = (value: string, text: string): void => { if (!seen.has(value)) { select.add(new Option(text, value)); seen.add(value); } };
      // The catalogue's genre is offered once: if the library already has a genre with that
      // name, that genre is the one selected - never a second shelf with the same name.
      const existing = this.book.genreName ? this.state.genres.find((genre) => Genre.sameName(genre.name, this.book.genreName)) : undefined;
      const suggested = existing?.id ?? (this.book.genreId || "sem-genero");
      addOption(suggested, existing?.name ?? (this.book.genreName || i18n.t("ui.catalog.unclassified")));
      this.state.genres.forEach((genre) => addOption(genre.id, genre.name));
      const customValue = "__catalog_custom_genre__";
      addOption(customValue, i18n.t("ui.onboarding.customGenres"));
      select.value = seen.has(suggested) ? suggested : "sem-genero";
      const custom = document.createElement("input"); custom.className = "input"; custom.hidden = true; custom.placeholder = i18n.t("ui.onboarding.customGenrePlaceholder"); custom.maxLength = 80;
      const error = document.createElement("p"); error.className = "form-error"; error.setAttribute("role", "alert");
      select.addEventListener("change", () => { custom.hidden = select.value !== customValue; if (!custom.hidden) custom.focus(); });
      label.append(labelText, select); const actions = document.createElement("div"); actions.className = "catalog-genre-dialog__actions";
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "button button--secondary"; cancel.textContent = i18n.t("ui.common.cancel");
      const confirm = document.createElement("button"); confirm.type = "button"; confirm.className = "button button--primary"; confirm.textContent = i18n.t("catalog.addToLibrary");
      const close = (result: CatalogBookData | null): void => { overlay.remove(); resolve(result); };
      cancel.addEventListener("click", () => close(null));
      overlay.addEventListener("click", (event) => { if (event.target === overlay) close(null); });
      confirm.addEventListener("click", () => {
        const titleValue = title.input.value.trim();
        if (!titleValue) { error.textContent = i18n.t("ui.edit.bookTitle"); title.input.focus(); return; }
        let genreId = select.value; let genreName = select.selectedOptions[0]?.textContent?.trim() ?? i18n.t("ui.catalog.unclassified");
        if (genreId === customValue) {
          genreName = custom.value.trim();
          if (!genreName) { error.textContent = i18n.t("ui.onboarding.customGenreHelp"); return; }
          genreId = crypto.randomUUID();
        }
        close({ ...this.book, title: titleValue, author: author.input.value.trim() || i18n.t("ui.book.unknownAuthor"), genreId, genreName });
      });
      actions.append(cancel, confirm); dialog.append(heading, details, title.label, author.label, label, custom, error, actions); overlay.append(dialog); document.body.append(overlay); title.input.focus();
    });
  }
  private field(text: string, value: string, required: boolean): { label: HTMLLabelElement; input: HTMLInputElement } {
    const label = document.createElement("label"); label.className = "field";
    const caption = document.createElement("span"); caption.className = "field__label"; caption.textContent = text;
    const input = document.createElement("input"); input.className = "input"; input.value = value; input.required = required; input.maxLength = 180;
    label.append(caption, input); return { label, input };
  }
  private text(className: string, value: string): HTMLElement { const element = document.createElement("p"); element.className = className; element.textContent = value; return element; }
}
