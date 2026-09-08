import type{Book}from"../models/Book";import{BookVolumeFormatter}from"./BookVolumeFormatter";
export interface ShelfContext{kind:"genre"|"author"|"collection";label:string;}
export interface BookFocusLabelData{title:string;subtitle?:string;}
export class BookContextLabelResolver {public resolve(book:Book,context:ShelfContext):BookFocusLabelData{const volume=new BookVolumeFormatter().format(book.volume),title=`${book.title}${volume?` · ${volume}`:""}`,sameAuthor=context.kind==="author"&&this.same(context.label.replace(/^Obras de\s+/i,""),book.author);return{title,subtitle:sameAuthor?undefined:book.author||undefined};}private same(a:string,b:string):boolean{return a.localeCompare(b,undefined,{sensitivity:"base"})===0;}}
