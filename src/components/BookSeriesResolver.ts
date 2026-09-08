import type { Book } from "../models/Book";

export interface BookSeriesIdentity { baseTitle:string; normalizedBaseTitle:string; authorKey:string; volume?:number; }

export class BookSeriesResolver {
  private static readonly VOLUME_PATTERN=/\s*(?:[-–—:]\s*)?(?:vol(?:ume)?\.?|v\.?|parte|tomo)\s*(\d+)\b/iu;

  public resolve(book:Pick<Book,"title"|"author"|"volume"|"series">):BookSeriesIdentity {
    const titleMatch=book.title.match(BookSeriesResolver.VOLUME_PATTERN);
    const explicit=book.volume?.match(/\d+/u);
    const volume=explicit?Number(explicit[0]):titleMatch?Number(titleMatch[1]):undefined;
    const baseTitle=(book.series?.trim()||book.title.replace(BookSeriesResolver.VOLUME_PATTERN,"").trim()).replace(/[\s:–—-]+$/u,"").trim();
    return{baseTitle,normalizedBaseTitle:this.normalize(baseTitle),authorKey:this.normalize(book.author),volume};
  }

  public order(books:readonly Book[]):Book[]{
    const identities=new Map(books.map(book=>[book.id,this.resolve(book)]));
    const groups=new Map<string,Book[]>();
    books.forEach(book=>{const identity=identities.get(book.id)!;if(identity.volume===undefined)return;const key=`${identity.authorKey}::${identity.normalizedBaseTitle}`,items=groups.get(key)??[];items.push(book);groups.set(key,items);});
    const emitted=new Set<string>(),result:Book[]=[];
    for(const book of books){if(emitted.has(book.id))continue;const identity=identities.get(book.id)!;const key=`${identity.authorKey}::${identity.normalizedBaseTitle}`,series=groups.get(key);if(series&&series.length>1){series.sort((a,b)=>(identities.get(a.id)!.volume??Number.MAX_SAFE_INTEGER)-(identities.get(b.id)!.volume??Number.MAX_SAFE_INTEGER));series.forEach(value=>{emitted.add(value.id);result.push(value);});}else{emitted.add(book.id);result.push(book);}}
    return result;
  }

  public sameSeries(a:Pick<Book,"title"|"author"|"volume"|"series">,b:Pick<Book,"title"|"author"|"volume"|"series">):boolean{const left=this.resolve(a),right=this.resolve(b);return Boolean(left.normalizedBaseTitle)&&left.normalizedBaseTitle===right.normalizedBaseTitle&&left.authorKey===right.authorKey;}
  private normalize(value:string):string{return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase().replace(/\s+/g," ").trim();}
}
