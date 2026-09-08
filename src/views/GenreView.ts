import { AppState } from "../core/AppState";
import { BookShelf } from "../components/BookShelf";
import { BaseView } from "./BaseView";

export class GenreView extends BaseView {
  public constructor(
    private readonly state: AppState,
    private readonly genreId: string,
    private readonly onBack: () => void,
    private readonly onBookOpen: (bookId: string) => void,
  ) {
    super();
  }

  public render(): HTMLElement {
    const section = this.createElement("section", "page-shell");
    const back = this.createElement("button", "back-link", "← Voltar à biblioteca");
    back.type = "button";
    back.addEventListener("click", this.onBack);
    const genre = this.state.genres.find((item) => item.id === this.genreId);
    section.append(back, this.createElement("h1", "page-title", genre?.name ?? "Gênero não encontrado"));
    if (genre) {
      const books = this.state.library.findBooksByGenre(genre.id);
      section.append(this.createElement("p", "page-subtitle", `${books.length} ${books.length === 1 ? "livro" : "livros"} nesta coleção.`));
      if (books.length) section.append(new BookShelf(books, this.onBookOpen).render());
      else section.append(this.createElement("p", "book-grid__empty genre-books", "Nenhum livro neste gênero ainda."));
    }
    return section;
  }
}
