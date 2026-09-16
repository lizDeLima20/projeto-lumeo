import type { Book } from "../models/Book";
import type { Genre } from "../models/Genre";
import { BookCard } from "../components/BookCard";
import { I18nManager } from "../i18n/I18nManager";
import { BaseView } from "./BaseView";

export class BookDetailsView extends BaseView {
  public constructor(private readonly book: Book | null, private readonly genre: Genre | null,
    private readonly onRead: () => void, private readonly onEdit: () => void,
    private readonly onDelete: () => void, private readonly onBack: () => void,private readonly onLocate?:()=>void,private readonly onDownloadOnDevice?:()=>void) { super(); }
  public render(): HTMLElement {
    const section = this.createElement("section", "page-shell details-page");
    const back = this.createElement("button", "back-link", this.t("ui.library.back")); back.type = "button"; back.addEventListener("click", this.onBack); section.append(back);
    if (!this.book) { section.append(this.createElement("h1", "page-title", this.t("ui.book.notFound"))); return section; }
    const layout = this.createElement("div", "details-layout");
    const preview = new BookCard(this.book, () => undefined).render(); preview.disabled = true;
    const content = this.createElement("div", "details-content");
    content.append(this.createElement("span", "eyebrow", this.genre?.name ?? this.t("ui.book.noGenre")), this.createElement("h1", "page-title", this.book.title),
      this.createElement("p", "page-subtitle", this.book.author || this.t("ui.book.unknownAuthor")), this.meta());
    const actions = this.createElement("div", "form-actions");
    const read=this.action(this.t("ui.book.read"), "button button--primary", this.onRead);read.disabled=this.book.availability!=="AVAILABLE";actions.append(read, this.action(this.t("ui.book.edit"), "button button--secondary", this.onEdit), this.action(this.t("ui.common.delete"), "button button--danger", () => {
      if (window.confirm(this.t("ui.book.deleteConfirm",{title:this.book?.title??""}))) this.onDelete();
    }));if(this.book.availability!=="AVAILABLE"){const fromCatalog=Boolean(this.book.catalogBookId);content.append(this.createElement("p","page-subtitle",fromCatalog?this.t("ui.book.fileRemote"):this.book.availability==="MISSING_FILE"?this.t("ui.book.fileMissing"):this.t("ui.book.fileInvalid")));actions.append(this.action(fromCatalog?this.t("ui.book.downloadOnDevice"):this.t("ui.book.locateFile"),"button button--secondary",()=>fromCatalog?this.onDownloadOnDevice?.():this.onLocate?.()));}
    content.append(actions); layout.append(preview, content); section.append(layout); return section;
  }
  private meta(): HTMLElement {
    const list = this.createElement("dl", "book-meta");
    const rows = [[this.t("ui.book.format"), this.book?.fileType.toUpperCase()], [this.t("ui.book.size"), this.formatSize(this.book?.fileSize ?? 0)],
      [this.t("ui.book.status"), this.statusLabel(this.book?.readingStatus ?? "unread")]];
    rows.forEach(([term, value]) => { list.append(this.createElement("dt", undefined, term), this.createElement("dd", undefined, value)); }); return list;
  }
  private action(label: string, className: string, action: () => void): HTMLButtonElement {
    const button = this.createElement("button", className, label); button.type = "button"; button.addEventListener("click", action); return button;
  }
  private formatSize(bytes: number): string { return I18nManager.shared.formatter.fileSize(bytes,I18nManager.shared.locale); }
  private statusLabel(status: Book["readingStatus"]): string { return { unread: this.t("ui.book.unread"), reading: this.t("ui.book.reading"), finished: this.t("ui.book.finished") }[status]; }
}
