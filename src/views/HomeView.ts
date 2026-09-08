import type { AppState } from "../core/AppState";
import { BaseView } from "./BaseView";

export class HomeView extends BaseView {
  public constructor(private readonly state: AppState, private readonly userName: string,
    private readonly onOpenLibrary: () => void, private readonly onAddBook: () => void) { super(); }
  public render(): HTMLElement {
    const section = this.createElement("section", "home-view"); const copy = this.createElement("div", "home-copy");
    copy.append(this.createElement("span", "eyebrow", `Olá, ${this.userName}`), this.createElement("h1", "home-title", "Sua próxima história está aqui."),
      this.createElement("p", "page-subtitle", `${this.state.books.length} ${this.state.books.length === 1 ? "livro guardado" : "livros guardados"} no seu ambiente de leitura.`));
    const stage = this.createElement("div", "book-stage"); const book = this.createElement("button", "closed-book");
    book.type = "button"; book.setAttribute("aria-label", "Abrir minha biblioteca");
    const front = this.createElement("span", "closed-book__front"); front.append(this.createElement("span", "closed-book__mark", "L"), this.createElement("strong", undefined, "Minha biblioteca"));
    book.append(front, this.createElement("span", "closed-book__pages"), this.createElement("span", "closed-book__back"));
    book.addEventListener("click", () => { book.classList.add("closed-book--opening"); window.setTimeout(this.onOpenLibrary, 420); });
    stage.append(book, this.createElement("span", "book-stage__hint", "Toque no livro para abrir"));
    const add = this.createElement("button", "button button--secondary", "+ Adicionar livro"); add.type = "button"; add.addEventListener("click", this.onAddBook);
    section.append(copy, stage, add); return section;
  }
}
