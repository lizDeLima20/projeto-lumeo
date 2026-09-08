import type { Book } from "../models/Book";import{BookVolumeFormatter}from"./BookVolumeFormatter";
export class BookSpineRenderer {
  public static readonly textOrientation="ROTATED_UNIT" as const;
  public render(book:Book):HTMLElement{const spine=document.createElement("span"),text=document.createElement("span"),title=document.createElement("strong");spine.className="book-spine";text.className="book-spine__text";title.textContent=book.title;const volume=new BookVolumeFormatter().format(book.volume);text.append(title);if(volume){const element=document.createElement("span");element.className="book-spine__volume";element.textContent=volume;text.append(element);}if(book.author){const author=document.createElement("small");author.textContent=book.author;text.append(author);}spine.append(text);return spine;}
  public static text(book:Pick<Book,"title"|"author"|"volume">):string[]{return[book.title,book.author,book.volume].filter((value):value is string=>Boolean(value?.trim()));}
  public static fallbackColor(fileType:Book["fileType"]):string{return fileType==="epub"?"#633424":"#302b59";}
}
