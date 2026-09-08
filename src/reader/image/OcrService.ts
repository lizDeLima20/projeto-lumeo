export interface OcrResult{text:string;confidence:number;language?:string;}
export interface OcrProvider{recognize(canvas:HTMLCanvasElement,signal?:AbortSignal):Promise<OcrResult|null>;}
export class DisabledOcrProvider implements OcrProvider{public async recognize():Promise<OcrResult|null>{return null;}}
export class OcrService{public constructor(private readonly provider:OcrProvider=new DisabledOcrProvider()){}public recognize(canvas:HTMLCanvasElement,signal?:AbortSignal):Promise<OcrResult|null>{return this.provider.recognize(canvas,signal);}}
