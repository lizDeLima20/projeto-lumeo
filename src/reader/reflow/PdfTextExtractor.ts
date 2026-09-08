import type { PDFDocumentProxy } from "pdfjs-dist";
export interface TextBlock { text: string; page: number; fontSize: number; lineBreak: boolean; }
export class PdfTextExtractor {
  public async extract(document: PDFDocumentProxy): Promise<TextBlock[]> { const blocks: TextBlock[] = [];
    for (let pageNumber=1;pageNumber<=document.numPages;pageNumber++) { const content=await (await document.getPage(pageNumber)).getTextContent();
      content.items.forEach(item=>{if("str" in item&&item.str.trim()) blocks.push({text:item.str.trim(),page:pageNumber,fontSize:Math.abs(item.transform[3]??12),lineBreak:item.hasEOL});}); }
    return blocks;
  }
}
