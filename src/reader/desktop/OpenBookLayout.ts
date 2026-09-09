import{BookPageView}from"../../views/BookPageView";import{PageSpread,noNeighbours,type SpreadNeighbours}from"./PageSpread";import type{ReaderPage,ReaderParagraph}from"../reflow/ReaderDocument";
export class OpenBookLayout {
  public constructor(private readonly paragraph?:(value:ReaderParagraph)=>HTMLElement){}
  public render(spread:PageSpread,neighbours:SpreadNeighbours=noNeighbours):HTMLElement{
    const book=document.createElement("div");book.className="open-book-layout";
    const cover=spread.left?.cover?spread.left:spread.right?.cover?spread.right:null;
    if(cover){book.classList.add("open-book-layout--cover");book.append(new BookPageView(cover,"cover",this.paragraph).render());return book;}
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
  /** No copy of a page may keep the --left/--right modifier: those two classes are how
   *  the turn controller finds the leaf to animate, and a nested copy earlier in the
   *  document would win the querySelector. */
  public static readonly sideModifierIsUniquePerSpread = true;
  /** The side modifier is REPLACED, not added: leaving --left/--right on an uncovered
   *  page made it the first match for the querySelector that picks the leaf to turn,
   *  so the turn animated the hidden page instead of the visible one. */
  private under(page:ReaderPage|null,side:"left"|"right"):HTMLElement{
    const article=new BookPageView(page,side,this.paragraph).render();
    article.classList.replace(`open-book-page--${side}`,`open-book-page--under-${side}`);
    article.setAttribute("aria-hidden","true");
    return article;
  }
}
