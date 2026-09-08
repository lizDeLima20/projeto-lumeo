import type { ReaderDocument, ReaderPage, ReadingAnchor } from "./ReaderDocument";
export interface PaginationMetrics { width: number; height: number; fontSize: number; lineHeight: number; margin: number; }
export class PaginationEngine {
  public paginate(document: ReaderDocument, metrics: PaginationMetrics): ReaderPage[] {
    const usableWidth=Math.max(180,Math.min(metrics.width-2*metrics.margin,760)),usableHeight=Math.max(240,metrics.height-2*metrics.margin),lineHeight=Math.max(16,metrics.fontSize*metrics.lineHeight),paragraphGap=Math.max(6,metrics.fontSize*.75),pages:ReaderPage[]=[];
    let current:ReaderPage={index:0,paragraphs:[],startOffset:0,endOffset:0},offset=0,used=0;
    const push=()=>{current.endOffset=offset;if(current.paragraphs.length||!pages.length)pages.push(current);current={index:pages.length,paragraphs:[],startOffset:offset,endOffset:offset};used=0;};
    for(let paragraphIndex=0;paragraphIndex<document.paragraphs.length;paragraphIndex++){const paragraph=document.paragraphs[paragraphIndex]!,next=document.paragraphs[paragraphIndex+1],height=this.blockHeight(paragraph.text,paragraph.kind,usableWidth,metrics.fontSize,lineHeight,paragraphGap);
      if(paragraph.kind==="heading"&&next&&current.paragraphs.length){const pairHeight=height+this.blockHeight(next.text,next.kind,usableWidth,metrics.fontSize,lineHeight,paragraphGap);if(used+pairHeight>usableHeight&&pairHeight<=usableHeight)push();}
      if(current.paragraphs.length&&used+height>usableHeight)push();
      if(height<=usableHeight){current.paragraphs.push({...paragraph,sourceBlockId:paragraph.sourceBlockId??paragraph.id,sourceStart:paragraph.sourceStart??0});used+=height;offset+=paragraph.text.length;continue;}
      let remaining=paragraph.text,sourceStart=0;while(remaining.trim()){const available=current.paragraphs.length?usableHeight-used:usableHeight,piece=this.fitTextByWords(remaining,paragraph.kind,usableWidth,metrics.fontSize,lineHeight,paragraphGap,available);if(!piece&&current.paragraphs.length){push();continue;}const text=piece||this.firstWord(remaining);current.paragraphs.push({...paragraph,id:`${paragraph.id}-${sourceStart}`,sourceBlockId:paragraph.sourceBlockId??paragraph.id,sourceStart:(paragraph.sourceStart??0)+sourceStart,text});used+=this.blockHeight(text,paragraph.kind,usableWidth,metrics.fontSize,lineHeight,paragraphGap);offset+=text.length;sourceStart+=text.length;remaining=remaining.slice(text.length).trimStart();if(remaining)push();}
    }current.endOffset=offset;if(current.paragraphs.length||!pages.length)pages.push(current);return pages;
  }
  public withCover(pages:ReaderPage[],cover:{title:string;author?:string;image?:string}):ReaderPage[]{return[{index:0,paragraphs:[],startOffset:0,endOffset:0,cover},...pages.map((page,index)=>({...page,index:index+1}))];}
  public pageForAnchor(pages:readonly ReaderPage[],anchor:ReadingAnchor):number{const found=pages.findIndex(page=>!page.cover&&anchor.logicalOffset>=page.startOffset&&anchor.logicalOffset<=page.endOffset);return Math.max(0,found);}
  private blockHeight(text:string,kind:"heading"|"paragraph",width:number,fontSize:number,lineHeight:number,gap:number):number{
    const averageCharWidth=fontSize*(kind==="heading" ? .62 : .52);
    const lines=this.lineCount(text,width,averageCharWidth);
    return lines*lineHeight*(kind==="heading"?1.18:1)+gap*(kind==="heading"?1.2:1);
  }
  private lineCount(text:string,width:number,charWidth:number):number{let lines=1,current=0;for(const word of text.split(/\s+/).filter(Boolean)){const next=(current?current+charWidth:0)+word.length*charWidth;if(next>width&&current>0){lines++;current=word.length*charWidth;}else current=next;}return lines;}
  private fitTextByWords(text:string,kind:"heading"|"paragraph",width:number,fontSize:number,lineHeight:number,gap:number,available:number):string{const words=text.split(/\s+/).filter(Boolean);let best="";for(const word of words){const next=best?`${best} ${word}`:word;if(this.blockHeight(next,kind,width,fontSize,lineHeight,gap)>available)return best;best=next;}return best;}
  private firstWord(text:string):string{return text.match(/\S+/)?.[0]??"";}
}
