import type { Book } from "../models/Book";
import { BookCard } from "./BookCard";
import { BookSelectionController } from "./BookSelectionController";
import { BookPerspectiveLayout } from "./BookPerspectiveLayout";
import { ShelfBoard } from "./ShelfBoard";
import { BookFocusAnimator } from "./BookFocusAnimator";import{BookContextLabelResolver,type ShelfContext}from"./BookContextLabelResolver";import{ShelfFocusLabel}from"./ShelfFocusLabel";import{BookQuickPreview}from"./BookQuickPreview";
import { BookSeriesResolver } from "./BookSeriesResolver";

export class BookShelf {
  public static readonly trackScrolls=true;
  public static readonly backgroundClickClearsFocus=true;
  /** Scrolling the horizontal track must never cancel a deliberate selection. */
  public static readonly scrollClearsFocusedBook=false;
  private readonly selection = new BookSelectionController();
  private readonly animator=new BookFocusAnimator();
  private startX = 0; private startY = 0; private moved = false;
  public constructor(private readonly books: readonly Book[], private readonly onActivate: (bookId: string) => void,private readonly context:ShelfContext={kind:"genre",label:"Biblioteca"},private readonly onDelete?:(bookId:string)=>void|Promise<void>) {}
  public render(): HTMLElement {
    const stage=document.createElement("div");stage.className="shelf-stage";const viewport = document.createElement("div"); viewport.className = "book-shelf__viewport";
    const orderedBooks=new BookSeriesResolver().order(this.books);const profile = BookShelf.visualProfile(orderedBooks.length); const row = document.createElement("div"); row.className = `book-shelf${profile.frontal ? " book-shelf--frontal" : ""}`;row.dataset.visualMode=profile.mode;row.dataset.renderedShelfBookCount=String(orderedBooks.length);
    row.style.setProperty("--book-angle", `${profile.angle}deg`, "important"); row.style.setProperty("--selected-angle", `${profile.selectedAngle}deg`, "important");
    row.style.setProperty("--shelf-overlap", `${profile.overlap}rem`); row.style.setProperty("--shelf-gap", `${profile.gap}px`);
    orderedBooks.forEach((book) => row.append(new BookCard(book,(id)=>this.handleActivation(id,row,stage,viewport),this.selection,profile.mode,this.context.kind!=="author",this.onDelete).render()));
    viewport.addEventListener("pointerdown", (event) => { this.startX = event.clientX; this.startY = event.clientY; this.moved = false; }, { passive: true });
    /* A drag only suppresses the click produced at pointerup.  Clearing focus here
       * made a selected book return as soon as a trackpad emitted a tiny scroll. */
    viewport.addEventListener("pointermove", (event) => { if (!this.moved&&!BookShelf.isTap(event.clientX - this.startX, event.clientY - this.startY)) this.moved = true; }, { passive: true });
    viewport.addEventListener("click", (event) => { if (this.moved) { event.preventDefault(); event.stopPropagation(); this.moved = false; } }, true);
    viewport.addEventListener("click",(event)=>{const target=event.target as Element;if(!target.closest(".book-card,.book-focus-label"))this.clearFocus(row,stage);});
    viewport.append(row);stage.append(viewport,new ShelfBoard().render());stage.addEventListener("click",event=>{const target=event.target as Element;if(!target.closest(".book-card,.book-focus-label"))this.clearFocus(row,stage);});return stage;
  }
  public static compactionFor(count: number): number { if (count >= 20) return -5.1; if (count >= 12) return -4.35; if (count >= 7) return -3.5; return -2.5; }
  public static visualProfile(count: number) { return BookPerspectiveLayout.forCount(count); }
  public static isTap(deltaX: number, deltaY: number): boolean { return Math.hypot(deltaX, deltaY) <= 10; }
  private handleActivation(bookId: string, row: HTMLElement,stage:HTMLElement,viewport:HTMLElement): void {
    this.updateSelection(row);
    if(!this.selection.isSelected(bookId)){
      this.removeLabel(stage);
      return;
    }
    this.updateLabel(bookId,stage,viewport);
    const card = row.querySelector<HTMLElement>(`[data-book-id="${CSS.escape(bookId)}"]`); if (!card?.classList.contains("book-card--activating")) return;
    const message = document.createElement("span"); message.className = "good-reading"; message.textContent = "Boa leitura"; document.body.append(message);
    window.setTimeout(() => this.onActivate(bookId), 620); window.setTimeout(() => message.remove(), 900);
  }
  private updateSelection(row: HTMLElement): void {
    const cards = [...row.querySelectorAll<HTMLElement>(".book-card")];
    cards.forEach(card=>{const id=card.dataset.bookId??"",state=this.selection.state(id);this.animator.transition(card,state,()=>this.selection.settle(id));card.classList.remove("book-card--neighbor-before","book-card--neighbor-after");});
  }
  private updateLabel(bookId:string,stage:HTMLElement,viewport:HTMLElement):void{stage.querySelector(".book-focus-label")?.remove();const book=this.books.find(value=>value.id===bookId),card=viewport.querySelector<HTMLElement>(`[data-book-id="${CSS.escape(bookId)}"]`);if(!book||!card||card.classList.contains("book-card--activating"))return;const data=new BookContextLabelResolver().resolve(book,this.context),label=new ShelfFocusLabel().render(data,()=>document.body.append(new BookQuickPreview(book,this.context,()=>this.onActivate(book.id)).render()));stage.append(label);}
  private clearFocus(row:HTMLElement,stage:HTMLElement):void{if(!this.selection.deselect())return;this.updateSelection(row);this.removeLabel(stage);}
  private removeLabel(stage:HTMLElement):void{const label=stage.querySelector<HTMLElement>(".book-focus-label");if(label){label.classList.add("book-focus-label--leaving");window.setTimeout(()=>label.remove(),180);}}
}
