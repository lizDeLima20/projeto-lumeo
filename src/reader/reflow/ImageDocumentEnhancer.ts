export interface ImageEnhancement {brightness:number;contrast:number;grayscale:boolean;threshold:number;}
export class ImageDocumentEnhancer {public css(settings:ImageEnhancement):string{return `brightness(${settings.brightness}%) contrast(${settings.contrast}%) grayscale(${settings.grayscale?100:0}%) opacity(${Math.max(.75,1-settings.threshold/400)})`;}}
