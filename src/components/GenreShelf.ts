import type { Book } from "../models/Book";
import type { Genre } from "../models/Genre";
import { BookShelf } from "./BookShelf";
import { AuthorShelfGroup } from "./AuthorShelfGroup";

export class GenreShelf {
  public constructor(private readonly genre: Genre, private readonly books: readonly Book[],
    private readonly onGenreOpen: (genreId: string) => void, private readonly onBookOpen: (bookId: string) => void, private readonly onBookDelete?: (bookId: string) => void | Promise<void>) {}
  public render(): HTMLElement {
    const section = document.createElement("section"); section.className = "genre-shelf"; section.dataset.genreId = this.genre.id;section.dataset.searchText=[this.genre.name,...this.books.flatMap(book=>[book.title,book.author])].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase();
    const heading = document.createElement("button"); heading.type = "button"; heading.className = "genre-shelf__title"; heading.textContent = this.genre.name;
    heading.addEventListener("click", () => this.onGenreOpen(this.genre.id)); const count = document.createElement("span"); count.className = "genre-shelf__count"; count.textContent = `${this.books.length} ${this.books.length === 1 ? "livro" : "livros"}`;
    section.append(heading, count);const grouping=new AuthorShelfGroup().group(this.books);grouping.groups.forEach(group=>{const wrapper=document.createElement("section"),title=document.createElement("h3"),label=`Obras de ${group.author}`;wrapper.className="author-shelf-group";title.className="author-shelf-group__title";title.textContent=label;wrapper.append(title,new BookShelf(group.books,this.onBookOpen,{kind:"author",label},this.onBookDelete).render());section.append(wrapper);});if(grouping.ungrouped.length)section.append(new BookShelf(grouping.ungrouped,this.onBookOpen,{kind:"genre",label:this.genre.name},this.onBookDelete).render());return section;
  }
  public static shouldRender(books: readonly Book[]): boolean { return books.length > 0; }
}
