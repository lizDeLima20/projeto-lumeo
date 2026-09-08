import type { Book } from "../models/Book";
import type { BookVisualMode } from "./BookPerspectiveLayout";
import { BookSelectionController } from "./BookSelectionController";
import { BookShelfCard3D } from "./BookShelfCard3D";
export class BookCard extends BookShelfCard3D { public constructor(book:Book,onOpen:(bookId:string)=>void,selection=new BookSelectionController(),mode:BookVisualMode="FRONT",showAuthor=true,onDelete?:(bookId:string)=>void|Promise<void>){super(book,onOpen,selection,mode,showAuthor,onDelete);} }
