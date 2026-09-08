import type{ReadingAnchor}from"../reader/reflow/ReaderDocument";
export interface BookmarkData{id:string;bookId:string;anchor:ReadingAnchor;label?:string;createdAt:string;}
export class Bookmark implements BookmarkData {public readonly id:string;public readonly bookId:string;public readonly anchor:ReadingAnchor;public readonly label?:string;public readonly createdAt:string;public constructor(data:BookmarkData){Object.assign(this,data);this.id=data.id;this.bookId=data.bookId;this.anchor=data.anchor;this.label=data.label;this.createdAt=data.createdAt;}}
