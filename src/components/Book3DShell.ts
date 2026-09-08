import type { Book } from "../models/Book";
import { Book3DFactory } from "./Book3DFactory";
import type { Book3DMode } from "./Book3DModel";
export type { Book3DMode } from "./Book3DModel";

/** Compatibility facade. Book3D is the physical visual object. */
export class Book3DShell {
  public constructor(private readonly book: Book, private readonly mode: Book3DMode,private readonly showAuthor=true,private readonly factory = new Book3DFactory()) {}
  public render(): HTMLElement { const object = this.factory.create(this.book,this.mode,this.showAuthor).render(); object.classList.add("book-cover", "book-3d-shell"); return object; }
  public static hasSpine(mode: Book3DMode): boolean { return mode !== "FRONT"; }
  public static hasTop(mode: Book3DMode): boolean { return mode !== "FRONT"; }
  public static focus(mode: Book3DMode): Book3DMode { return mode === "FRONT" ? "FRONT" : "FOCUSED_ANGLED"; }
}
