import type { ReaderPage, ReaderParagraph } from "../reader/reflow/ReaderDocument";

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
      const frame = document.createElement("div");
      frame.className = "reader-cover-page";
      if (this.page.cover.image) {
        const image = document.createElement("img");
        image.src = this.page.cover.image;
        image.alt = `Capa de ${this.page.cover.title}`;
        frame.append(image);
      } else {
        const fallback = document.createElement("div");
        fallback.className = "reader-cover-page__fallback";
        fallback.textContent = this.page.cover.title.slice(0, 2).toUpperCase();
        frame.append(fallback);
      }
      article.append(frame);
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
    number.textContent = String(this.page.index + 1);
    article.append(number);
    return article;
  }
}
