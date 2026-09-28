import type { ComicStencil, ComicVisualContainer } from "./ComicContainerDetector";
import type { ComicPageAsset, ComicTextRegion } from "./ComicInteractionTypes";
import { comicCreateCutouts } from "./ComicObjectCutout";

/** Original archive art, not the fitted display bitmap. Peak target canvas is bounded.
 * PDF assets already match their analysis render and take the unchanged fast path. */
export async function comicCreateOriginalCutouts(canvas:HTMLCanvasElement, regions:ComicTextRegion[], containers:readonly ComicVisualContainer[], encoded?:ComicPageAsset):Promise<ComicPageAsset[]> {
  if (!encoded?.width || !encoded.height || (encoded.width===canvas.width && encoded.height===canvas.height)) return comicCreateCutouts(canvas,regions,containers);
  const ratio=Math.min(1,Math.sqrt(12_000_000/(encoded.width*encoded.height)));
  const width=Math.max(1,Math.floor(encoded.width*ratio)),height=Math.max(1,Math.floor(encoded.height*ratio));
  if(width<=canvas.width && height<=canvas.height)return comicCreateCutouts(canvas,regions,containers);
  const bitmap=await createImageBitmap(new Blob([new Uint8Array(encoded.data)],{type:encoded.mimeType}),{resizeWidth:width,resizeHeight:height,resizeQuality:"high"});
  const original=document.createElement("canvas");original.width=width;original.height=height;
  try{
    const context=original.getContext("2d",{alpha:false,willReadFrequently:true});if(!context)throw new Error("Canvas indisponível para recorte original.");
    context.fillStyle="#ffffff";context.fillRect(0,0,width,height);context.drawImage(bitmap,0,0,width,height);
    const sx=width/canvas.width,sy=height/canvas.height;
    const box=(b:{x0:number;y0:number;x1:number;y1:number})=>({x0:b.x0*sx,y0:b.y0*sy,x1:b.x1*sx,y1:b.y1*sy});
    const stencil=(s:ComicStencil):ComicStencil=>comicScaleCutoutStencil(s,sx,sy);
    const scaled=containers.map(c=>({...c,bbox:box(c.bbox),ink:box(c.ink),artBbox:c.artBbox?box(c.artBbox):undefined,
      stencil:stencil(c.stencil),artStencil:c.artStencil?stencil(c.artStencil):undefined,contour:c.contour.map(p=>({x:p.x*sx,y:p.y*sy}))}));
    return await comicCreateCutouts(original,regions,scaled);
  }finally{bitmap.close();original.width=original.height=0;}
}

/** Preserve each axis after pixel rounding; a scalar step would shift the last row. */
export function comicScaleCutoutStencil(s:ComicStencil,sx:number,sy:number):ComicStencil {
  const width=Math.max(1,Math.ceil(s.width*s.step*sx)),height=Math.max(1,Math.ceil(s.height*s.step*sy));
  const data=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sourceX=Math.min(s.width-1,Math.floor(x/(s.step*sx)));
    const sourceY=Math.min(s.height-1,Math.floor(y/(s.step*sy)));
    data[y*width+x]=s.data[sourceY*s.width+sourceX]!;
  }
  return {width,height,data,step:1,x:s.x*sx,y:s.y*sy};
}
