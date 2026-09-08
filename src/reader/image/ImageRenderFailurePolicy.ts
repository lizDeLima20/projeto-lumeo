export interface ImageRenderFailureState{message:string;canRetry:boolean;canGoPrevious:boolean;canGoNext:boolean;}
export class ImageRenderFailurePolicy{public state(page:number,total:number):ImageRenderFailureState{return{message:"reader.imageMode.renderError",canRetry:true,canGoPrevious:page>1,canGoNext:page<total};}}
