export type BookActivation = "selected" | "activated";
export type BookFocusState="RESTING"|"FOCUSING"|"FOCUSED"|"RETURNING";

export class BookSelectionController {
  private selectedBookId: string | null = null;
  private readonly states=new Map<string,BookFocusState>();
  public select(bookId: string): string | null { const previous = this.selectedBookId;if(previous&&previous!==bookId)this.states.set(previous,"RETURNING"); this.selectedBookId = bookId;this.states.set(bookId,"FOCUSING"); return previous; }
  public deselect(): string | null { const previous = this.selectedBookId;if(previous)this.states.set(previous,"RETURNING"); this.selectedBookId = null; return previous; }
  public isSelected(bookId: string): boolean { return this.selectedBookId === bookId; }
  public selected(): string | null { return this.selectedBookId; }
  public activate(bookId: string): BookActivation { if (this.isSelected(bookId)) return "activated"; this.select(bookId); return "selected"; }
  public settle(bookId:string):void{if(this.isSelected(bookId))this.states.set(bookId,"FOCUSED");else this.states.set(bookId,"RESTING");}
  public state(bookId:string):BookFocusState{return this.states.get(bookId)??"RESTING";}
}
