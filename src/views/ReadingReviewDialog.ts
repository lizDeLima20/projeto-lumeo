import { I18nManager } from "../i18n/I18nManager";

export class ReadingReviewDialog {
  public constructor(private readonly onSave: (rating: 1 | 2 | 3 | 4 | 5, comment: string) => Promise<void>) {}

  public render(): HTMLElement {
    const i18n = I18nManager.shared, layer = document.createElement("div"), dialog = document.createElement("form");
    layer.className = "reading-review-layer"; dialog.className = "reading-review-dialog";
    dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true");
    const title = document.createElement("h2"); title.textContent = i18n.t("reader.review.title");
    const help = document.createElement("p"); help.textContent = i18n.t("reader.review.help");
    const stars = document.createElement("div"); stars.className = "reading-review-stars"; stars.setAttribute("role", "radiogroup");
    let selected = 0;
    const buttons = [1, 2, 3, 4, 5].map(value => {
      const button = document.createElement("button"); button.type = "button"; button.className = "reading-review-star"; button.textContent = "★";
      button.setAttribute("role", "radio"); button.setAttribute("aria-label", i18n.t("reader.review.stars", { count:value }));
      button.setAttribute("aria-checked", "false");
      button.addEventListener("click", () => { selected = value; buttons.forEach((star, index) => {
        star.classList.toggle("is-selected", index < value); star.setAttribute("aria-checked", String(index === value - 1));
      }); });
      return button;
    });
    stars.append(...buttons);
    const comment = document.createElement("textarea"); comment.maxLength = 500; comment.rows = 3;
    comment.placeholder = i18n.t("reader.review.commentPlaceholder"); comment.setAttribute("aria-label", i18n.t("reader.review.comment"));
    const actions = document.createElement("div"); actions.className = "reading-review-actions";
    const later = document.createElement("button"); later.type = "button"; later.textContent = i18n.t("reader.review.later");
    const save = document.createElement("button"); save.type = "submit"; save.disabled = true; save.textContent = i18n.t("reader.review.save");
    stars.addEventListener("click", () => { save.disabled = selected === 0; });
    const close = (): void => layer.remove();
    later.addEventListener("click", close);
    dialog.addEventListener("submit", async event => { event.preventDefault(); if (!selected) return; save.disabled = true;
      await this.onSave(selected as 1 | 2 | 3 | 4 | 5, comment.value.trim()); close(); });
    actions.append(later, save); dialog.append(title, help, stars, comment, actions); layer.append(dialog);
    return layer;
  }
}
