import{BookPageView}from"../../views/BookPageView";import{PageSpread,noNeighbours,type SpreadNeighbours}from"./PageSpread";import type{ReaderPage,ReaderParagraph}from"../reflow/ReaderDocument";
export type DesktopCoverState = "closed" | "open";

export class OpenBookLayout {
  public constructor(private readonly paragraph?:(value:ReaderParagraph)=>HTMLElement){}
  public render(spread:PageSpread,neighbours:SpreadNeighbours=noNeighbours,coverState:DesktopCoverState="closed"):HTMLElement{
    const book=document.createElement("div");book.className="open-book-layout";
    const cover=spread.left?.cover?spread.left:spread.right?.cover?spread.right:null;
    if(cover){
      book.classList.add("open-book-layout--cover", `open-book-layout--${coverState}`);
      const afterCover=spread.left?.cover?spread.right:spread.left;
      if(coverState==="open") {
        const back=this.hardCoverInside("left");
        const first=new BookPageView(afterCover,"right",this.paragraph).render();
        first.classList.add("open-book-page--right");
        /* Page 1 is a leaf like any other: its back and the page it uncovers are built
         * with it, so turning it never opens onto an empty sheet. */
        first.append(this.verso(neighbours.versoAfter,"right"));
        book.append(this.under(neighbours.underAfter,"right"),back,first);
        return book;
      }
      /* The first real page is prepared under the cover for the physical turn, but is
       * fully hidden while closed. It never participates in the closed layout. */
      if(afterCover){const under=new BookPageView(afterCover,"right",this.paragraph).render();under.className="open-book-page open-book-page--under-cover";under.setAttribute("aria-hidden","true");book.append(under);}
      const leaf=new BookPageView(cover,"cover",this.paragraph).render();
      /* The back of a physical cover is still the cover material, never page 1 or
       * copyright text. This prevents content leaking at the 90° crossover. */
      leaf.append(this.coverVerso());
      book.append(leaf);
      return book;
    }
    /* Uncovered pages go in first so they sit behind; each shares the grid cell of the
     * leaf that reveals it. Without them a turn opened onto the stage background. */
    book.append(this.under(neighbours.underBefore,"left"),this.under(neighbours.underAfter,"right"));
    const left=new BookPageView(spread.left,"left",this.paragraph).render();
    const right=new BookPageView(spread.right,"right",this.paragraph).render();
    left.append(this.verso(neighbours.versoBefore,"left"));
    right.append(this.verso(neighbours.versoAfter,"right"));
    book.append(left,right);
    return book;
  }
  /** The back of a leaf carries the next page's real text, mirrored in its own plane
   *  so that it reads correctly once the leaf has come past 90deg. */
  private verso(page:ReaderPage|null,side:"left"|"right"):HTMLElement{
    const face=document.createElement("div");face.className="page-turn-verso";face.setAttribute("aria-hidden","true");
    if(page){const inner=new BookPageView(page,side,this.paragraph).render();
      inner.classList.replace(`open-book-page--${side}`,"open-book-page--verso");face.append(inner);}
    return face;
  }
  private coverVerso():HTMLElement{
    const face=document.createElement("div");face.className="page-turn-verso page-turn-verso--cover";face.setAttribute("aria-hidden","true");
    face.append(this.hardCoverInside("verso"));return face;
  }
  /** Interior of a hard cover: opaque material, never a second copy of the artwork
   * and never document content. The same physical face is used in the open layout and
   * in the reverse side of the cover while it turns. */
  private hardCoverInside(side:"left"|"verso"):HTMLElement{
    const face=document.createElement("article");face.className=`open-book-page open-book-page--${side} open-book-page--cover-back`;
    face.setAttribute("aria-hidden","true");const lining=document.createElement("div");lining.className="reader-hard-cover-lining";face.append(lining);return face;
  }
  /** No copy of a page may keep the --left/--right modifier: those two classes are how
   *  the turn controller finds the leaf to animate, and a nested copy earlier in the
   *  document would win the querySelector. */
  public static readonly sideModifierIsUniquePerSpread = true;
  /** The side modifier is REPLACED, not added: leaving --left/--right on an uncovered
   *  page made it the first match for the querySelector that picks the leaf to turn,
   *  so the turn animated the hidden page instead of the visible one. */
  private under(page:ReaderPage|null,side:"left"|"right"):HTMLElement{
    /* Behind page 1 lies the cover's lining, never the cover artwork. */
    if(page?.cover){const lining=this.hardCoverInside("left");lining.className=`open-book-page open-book-page--under-${side} open-book-page--cover-back`;return lining;}
    const article=new BookPageView(page,side,this.paragraph).render();
    article.classList.replace(`open-book-page--${side}`,`open-book-page--under-${side}`);
    article.setAttribute("aria-hidden","true");
    return article;
  }
}
