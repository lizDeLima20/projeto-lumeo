import type { ReaderPage } from "../reflow/ReaderDocument";
export class PageSpread { public constructor(public readonly left:ReaderPage|null,public readonly right:ReaderPage|null){}public get anchorPage():number{return this.left?.index!==undefined?this.left.index+1:this.right?.index!==undefined?this.right.index+1:1;} }
