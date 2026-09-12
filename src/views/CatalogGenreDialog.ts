import type { AppState } from "../core/AppState";
import type { CatalogBookData } from "../models/CatalogBook";
import { I18nManager } from "../i18n/I18nManager";

/** A small, local-only confirmation step before a remote catalog file is downloaded. */
export class CatalogGenreDialog {
  public constructor(private readonly state: AppState, private readonly book: CatalogBookData) {}

  public open(): Promise<CatalogBookData | null> {
    return new Promise((resolve) => {
      const i18n = I18nManager.shared;
      const overlay = document.createElement("div"); overlay.className = "catalog-genre-dialog";
      const dialog = document.createElement("section"); dialog.className = "catalog-genre-dialog__panel"; dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true");
      const title = document.createElement("h2"); title.textContent = `${i18n.t("ui.common.confirm")} · ${i18n.t("ui.catalog.genre")}`;
      const bookName = document.createElement("p"); bookName.className = "catalog-genre-dialog__book"; bookName.textContent = this.book.title;
      const label = document.createElement("label"); label.className = "field";
      const labelText = document.createElement("span"); labelText.className = "field__label"; labelText.textContent = i18n.t("ui.catalog.genre");
      const select = document.createElement("select"); select.className = "input";
      const seen = new Set<string>();
      const addOption = (value: string, text: string): void => { if (!seen.has(value)) { select.add(new Option(text, value)); seen.add(value); } };
      addOption(this.book.genreId || "sem-genero", this.book.genreName || i18n.t("ui.catalog.unclassified"));
      this.state.genres.forEach((genre) => addOption(genre.id, genre.name));
      const customValue = "__catalog_custom_genre__";
      addOption(customValue, i18n.t("ui.onboarding.customGenres"));
      select.value = seen.has(this.book.genreId) ? this.book.genreId : "sem-genero";
      const custom = document.createElement("input"); custom.className = "input"; custom.hidden = true; custom.placeholder = i18n.t("ui.onboarding.customGenrePlaceholder"); custom.maxLength = 80;
      const error = document.createElement("p"); error.className = "form-error"; error.setAttribute("role", "alert");
      select.addEventListener("change", () => { custom.hidden = select.value !== customValue; if (!custom.hidden) custom.focus(); });
      label.append(labelText, select); const actions = document.createElement("div"); actions.className = "catalog-genre-dialog__actions";
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "button button--secondary"; cancel.textContent = i18n.t("ui.common.cancel");
      const confirm = document.createElement("button"); confirm.type = "button"; confirm.className = "button button--primary"; confirm.textContent = i18n.t("ui.catalog.add");
      const close = (result: CatalogBookData | null): void => { overlay.remove(); resolve(result); };
      cancel.addEventListener("click", () => close(null));
      overlay.addEventListener("click", (event) => { if (event.target === overlay) close(null); });
      confirm.addEventListener("click", () => {
        let genreId = select.value; let genreName = select.selectedOptions[0]?.textContent?.trim() ?? i18n.t("ui.catalog.unclassified");
        if (genreId === customValue) {
          genreName = custom.value.trim();
          if (!genreName) { error.textContent = i18n.t("ui.onboarding.customGenreHelp"); return; }
          genreId = crypto.randomUUID();
        }
        close({ ...this.book, genreId, genreName });
      });
      actions.append(cancel, confirm); dialog.append(title, bookName, label, custom, error, actions); overlay.append(dialog); document.body.append(overlay); select.focus();
    });
  }
}
