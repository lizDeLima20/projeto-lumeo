import { I18nManager } from "../i18n/I18nManager";

export class ReadingReviewDialog {
  public constructor(private readonly onSave: (rating: 1 | 2 | 3 | 4 | 5, comment: string) => Promise<void>) {}

  public render(): HTMLElement {
    const layer = document.createElement("div"); layer.className = "reading-review-layer";
    layer.append(this.form(() => layer.remove())); return layer;
  }

  /** The final leaf uses the identical repository callback and rating controls,
   * but lives on the physical closing spread instead of in a detached modal. */
  public renderEmbedded(onComplete: () => void): HTMLElement { return this.form(onComplete, true); }

  private form(onComplete: () => void, embedded = false): HTMLElement {
    const i18n = I18nManager.shared, dialog = document.createElement("form");
    dialog.className = `reading-review-dialog${embedded ? " reading-review-dialog--embedded" : ""}`;
    dialog.setAttribute("role", "dialog"); if (!embedded) dialog.setAttribute("aria-modal", "true");
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
    const like = document.createElement("button"); like.type = "button"; like.className = "reading-review-like"; like.textContent = `♥ ${i18n.t("reader.review.like")}`;
    like.addEventListener("click", () => { selected = 5; buttons.forEach((star, index) => {
      star.classList.toggle("is-selected", index < 5); star.setAttribute("aria-checked", String(index === 4));
    }); save.disabled = false; like.classList.add("is-selected"); });
    const later = document.createElement("button"); later.type = "button"; later.textContent = i18n.t("reader.review.later");
    const save = document.createElement("button"); save.type = "submit"; save.disabled = true; save.textContent = i18n.t("reader.review.save");
    stars.addEventListener("click", () => { save.disabled = selected === 0; });
    later.addEventListener("click", onComplete);
    dialog.addEventListener("submit", async event => { event.preventDefault(); if (!selected) return; save.disabled = true;
      await this.onSave(selected as 1 | 2 | 3 | 4 | 5, comment.value.trim()); onComplete(); });
    actions.append(like, later, save); dialog.append(title, help, stars, comment, actions);
    return dialog;
  }
}
