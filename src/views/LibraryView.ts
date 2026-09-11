import { AppState } from "../core/AppState";
import { GenreShelf } from "../components/GenreShelf";
import { BaseView } from "./BaseView";

export class LibraryView extends BaseView {
  public constructor(
    private readonly state: AppState,
    private readonly onGenreOpen: (genreId: string) => void,
    private readonly onBookOpen: (bookId: string) => void,
    private readonly onBookDelete?: (bookId: string) => void | Promise<void>,
  ) {
    super();
  }

  public render(): HTMLElement {
    const section = this.createElement("section", "library page-shell");
    const heading = this.createElement("div", "page-heading");
    heading.append(
      this.createElement("h1", "page-title", this.t("ui.library.title")),
      this.createElement("p", "page-subtitle", this.t("ui.library.subtitle")),
    );
    const search=document.createElement("label");search.className="library-search";search.setAttribute("aria-label",this.t("ui.library.search"));
    const searchIcon=this.createElement("span","library-search__icon","⌕");searchIcon.setAttribute("aria-hidden","true");const input=document.createElement("input");input.type="search";input.placeholder=this.t("ui.library.searchPlaceholder");search.append(searchIcon,input);heading.append(search);section.append(heading);

    if (!this.state.genres.length) {
      section.append(this.createElement("p", "empty-state", this.t("ui.library.noGenres")));
      return section;
    }

    this.state.genres.forEach((genre) => { const books = this.state.library.findBooksByGenre(genre.id);
      if (GenreShelf.shouldRender(books)) section.append(new GenreShelf(genre, books, this.onGenreOpen, this.onBookOpen, this.onBookDelete).render()); });
    input.addEventListener("input",()=>{const query=input.value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase().trim();section.querySelectorAll<HTMLElement>(".genre-shelf").forEach(shelf=>{shelf.hidden=Boolean(query)&&!shelf.dataset.searchText?.includes(query);});});
    if (!section.querySelector(".genre-shelf")) section.append(this.createElement("p", "empty-state", this.t("ui.library.addFirst")));
    return section;
  }
}
