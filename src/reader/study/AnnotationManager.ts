import{Annotation,type AnnotationData}from"../../models/Annotation";import{AnnotationRepository}from"../../repositories/AnnotationRepository";
export class AnnotationManager{public constructor(private readonly repository:AnnotationRepository,private readonly userId?:string){}
  public list(bookId:string):Promise<AnnotationData[]>{return this.repository.byBook(bookId);}
  public async create(bookId:string,highlightId:string,text:string):Promise<Annotation>{const now=new Date().toISOString(),value=new Annotation({id:crypto.randomUUID(),userId:this.userId,bookId,highlightId,text:text.trim(),createdAt:now,updatedAt:now});await this.repository.save(value);return value;}
  public async edit(annotation:AnnotationData,text:string):Promise<Annotation>{const value=new Annotation({...annotation,text:text.trim(),updatedAt:new Date().toISOString()});await this.repository.save(value);return value;}
  public delete(id:string):Promise<void>{return this.repository.delete(id);}
  public forHighlight(id:string):Promise<AnnotationData|null>{return this.repository.byHighlight(id);}
  /** Ficha de estudo: significado and tradução share the same record as the note, keyed by
   *  the highlight, so one trecho keeps everything about it in one place. Never overwrites
   *  the other two fields - only the one being saved. */
  public async saveDefinition(bookId:string,highlightId:string,definitionText:string):Promise<Annotation>{return this.upsert(bookId,highlightId,{definitionText});}
  public async saveTranslation(bookId:string,highlightId:string,translationText:string):Promise<Annotation>{return this.upsert(bookId,highlightId,{translationText});}
  private async upsert(bookId:string,highlightId:string,changes:Partial<Pick<AnnotationData,"text"|"definitionText"|"translationText">>):Promise<Annotation>{
    const existing=await this.repository.byHighlight(highlightId),now=new Date().toISOString();
    const value=new Annotation({id:existing?.id??crypto.randomUUID(),userId:existing?.userId??this.userId,bookId,highlightId,text:existing?.text??"",definitionText:existing?.definitionText,translationText:existing?.translationText,...changes,createdAt:existing?.createdAt??now,updatedAt:now});
    await this.repository.save(value);return value;
  }
}
