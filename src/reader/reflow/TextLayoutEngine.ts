import type { TextBlock } from "./PdfTextExtractor"; import { ReaderDocument, type ReaderParagraph } from "./ReaderDocument";
export class TextLayoutEngine {
  public layout(blocks: readonly TextBlock[]): ReaderDocument { const paragraphs: ReaderParagraph[]=[]; let buffer="",page=1,maxSize=12;
    const flush=()=>{const text=buffer.replace(/\s+/g," ").trim();if(text)paragraphs.push({id:`p-${paragraphs.length}`,text,sourcePage:page,kind:maxSize>=18||text.length<70&&text===text.toUpperCase()?"heading":"paragraph"});buffer="";maxSize=12;};
    blocks.forEach(block=>{if(buffer&&block.page!==page)flush();page=block.page;buffer+=`${buffer?" ":""}${block.text}`;maxSize=Math.max(maxSize,block.fontSize);if(block.lineBreak||/[.!?…]$/.test(block.text))flush();});flush();
    return new ReaderDocument(paragraphs,paragraphs.reduce((sum,item)=>sum+item.text.length,0)); }
}
