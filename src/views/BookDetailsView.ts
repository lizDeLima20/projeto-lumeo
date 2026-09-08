import type { Book } from "../models/Book";
import type { Genre } from "../models/Genre";
import { BookCard } from "../components/BookCard";
import { BaseView } from "./BaseView";

export class BookDetailsView extends BaseView {
  public constructor(private readonly book: Book | null, private readonly genre: Genre | null,
    private readonly onRead: () => void, private readonly onEdit: () => void,
    private readonly onDelete: () => void, private readonly onBack: () => void,private readonly onLocate?:()=>void) { super(); }
  public render(): HTMLElement {
    const section = this.createElement("section", "page-shell details-page");
    const back = this.createElement("button", "back-link", "← Voltar à biblioteca"); back.type = "button"; back.addEventListener("click", this.onBack); section.append(back);
    if (!this.book) { section.append(this.createElement("h1", "page-title", "Livro não encontrado")); return section; }
    const layout = this.createElement("div", "details-layout");
    const preview = new BookCard(this.book, () => undefined).render(); preview.disabled = true;
    const content = this.createElement("div", "details-content");
    content.append(this.createElement("span", "eyebrow", this.genre?.name ?? "Sem gênero"), this.createElement("h1", "page-title", this.book.title),
      this.createElement("p", "page-subtitle", this.book.author || "Autor desconhecido"), this.meta());
    const actions = this.createElement("div", "form-actions");
    const read=this.action("Ler", "button button--primary", this.onRead);read.disabled=this.book.availability!=="AVAILABLE";actions.append(read, this.action("Editar", "button button--secondary", this.onEdit), this.action("Excluir", "button button--danger", () => {
      if (window.confirm(`Excluir “${this.book?.title}” e o arquivo armazenado?`)) this.onDelete();
    }));if(this.book.availability!=="AVAILABLE"){content.append(this.createElement("p","page-subtitle",this.book.availability==="MISSING_FILE"?"Arquivo local não encontrado.":"O arquivo local não pôde ser validado."));actions.append(this.action("Localizar arquivo","button button--secondary",()=>this.onLocate?.()));}
    content.append(actions); layout.append(preview, content); section.append(layout); return section;
  }
  private meta(): HTMLElement {
    const list = this.createElement("dl", "book-meta");
    const rows = [["Formato", this.book?.fileType.toUpperCase()], ["Tamanho", this.formatSize(this.book?.fileSize ?? 0)],
      ["Status", this.statusLabel(this.book?.readingStatus ?? "unread")]];
    rows.forEach(([term, value]) => { list.append(this.createElement("dt", undefined, term), this.createElement("dd", undefined, value)); }); return list;
  }
  private action(label: string, className: string, action: () => void): HTMLButtonElement {
    const button = this.createElement("button", className, label); button.type = "button"; button.addEventListener("click", action); return button;
  }
  private formatSize(bytes: number): string { return bytes < 1_048_576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`; }
  private statusLabel(status: Book["readingStatus"]): string { return { unread: "Não iniciado", reading: "Lendo", finished: "Concluído" }[status]; }
}
