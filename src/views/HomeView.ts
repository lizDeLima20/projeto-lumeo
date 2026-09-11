import type { AppState } from "../core/AppState";
import { BaseView } from "./BaseView";

export class HomeView extends BaseView {
  public constructor(private readonly state: AppState, private readonly userName: string,
    private readonly onOpenLibrary: () => void, private readonly onAddBook: () => void) { super(); }
  public render(): HTMLElement {
    const section = this.createElement("section", "home-view"); const copy = this.createElement("div", "home-copy");
    const saved=this.t("ui.home.booksSaved",{count:this.state.books.length}).split("|")[this.state.books.length===1?0:1]??"";
    copy.append(this.createElement("span", "eyebrow", this.t("ui.greeting.hello",{name:this.userName})), this.createElement("h1", "home-title", this.t("ui.home.title")),
      this.createElement("p", "page-subtitle", `${saved} ${this.t("ui.home.booksSavedSuffix")}`));
    const stage = this.createElement("div", "book-stage"); const book = this.createElement("button", "closed-book");
    book.type = "button"; book.setAttribute("aria-label", this.t("ui.home.openLibrary"));
    const front = this.createElement("span", "closed-book__front"); front.append(this.createElement("span", "closed-book__mark", "L"), this.createElement("strong", undefined, this.t("ui.home.myLibrary")));
    book.append(front, this.createElement("span", "closed-book__pages"), this.createElement("span", "closed-book__back"));
    book.addEventListener("click", () => { book.classList.add("closed-book--opening"); window.setTimeout(this.onOpenLibrary, 420); });
    stage.append(book, this.createElement("span", "book-stage__hint", this.t("ui.home.openHint")));
    const add = this.createElement("button", "button button--secondary", this.t("ui.home.addBook")); add.type = "button"; add.addEventListener("click", this.onAddBook);
    section.append(copy, stage, add); return section;
  }
}
