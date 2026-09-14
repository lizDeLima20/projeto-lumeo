import type { ReaderPage, ReaderParagraph } from "../reader/reflow/ReaderDocument";
import { ReaderCoverPageView } from "./ReaderCoverPageView";

export class BookPageView {
  public constructor(
    private readonly page: ReaderPage | null,
    private readonly position: "left" | "right" | "cover",
    private readonly paragraph?: (value: ReaderParagraph) => HTMLElement
  ) {}

  public render(): HTMLElement {
    const article = document.createElement("article");
    article.className = `open-book-page open-book-page--${this.position}`;
    if (!this.page) {
      article.classList.add("open-book-page--blank");
      return article;
    }
    if (this.page.cover) {
      article.classList.add("open-book-page--cover");
      article.append(new ReaderCoverPageView().render(this.page.cover));
      return article;
    }
    this.page.paragraphs.forEach((value) => {
      const element = this.paragraph?.(value) ?? document.createElement(value.kind === "heading" ? "h2" : "p");
      if (!this.paragraph) {
        element.className = `reader-${value.kind}`;
        element.textContent = value.text;
      }
      article.append(element);
    });
    const number = document.createElement("span");
    number.className = "open-book-page__number";
    number.textContent = this.page.visualLabel ?? String(this.page.index + 1);
    article.append(number);
    return article;
  }
}
