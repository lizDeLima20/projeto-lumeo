import type { ReaderPage } from "../reflow/ReaderDocument";
export class PageSpread { public constructor(public readonly left:ReaderPage|null,public readonly right:ReaderPage|null){}public get anchorPage():number{return this.left?.index!==undefined?this.left.index+1:this.right?.index!==undefined?this.right.index+1:1;} }

/** The four pages a spread needs beyond the two it shows, so a leaf in flight has
 *  real paper on both of its own sides and real paper underneath it.
 *  Turning forward: the right leaf's back is `versoAfter`, and `underAfter` is what
 *  it uncovers. Turning back: the left leaf's back is `versoBefore`, over
 *  `underBefore`. Any of them may be null at the ends of the book. */
export interface SpreadNeighbours {
  versoAfter: ReaderPage | null;
  underAfter: ReaderPage | null;
  versoBefore: ReaderPage | null;
  underBefore: ReaderPage | null;
}
export const noNeighbours: SpreadNeighbours = { versoAfter: null, underAfter: null, versoBefore: null, underBefore: null };
