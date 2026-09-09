export interface PageTransform {progress:number;angle:number;translateX:number;translateZ:number;skewY:number;scaleX:number;curlInset:number;curlTail:number;curlRadius:number;origin:string;}
/** A leaf is a rigid rectangle hinged on the gutter. It swings sideways and lands
 *  flat; it is never skewed, squeezed or corner-clipped, so the type on it stays
 *  perfectly set at every angle. The only depth is a small lift off the block so
 *  the paper clears the gutter at mid-swing. */
export class PageGeometry {
  public static readonly landingAngle=178;
  public static readonly liftPixels=14;
  /** The leaf tracks the finger one-to-one: no easing during the drag. */
  public static readonly tracksPointerLinearly=true;
  public static readonly keepsPerfectRectangle=true;
  public calculate(deltaX:number,width:number,direction:1|-1):PageTransform{
    const progress=Math.min(1,Math.max(0,Math.abs(deltaX)/Math.max(1,width))),lift=Math.sin(progress*Math.PI);
    return{progress,
      angle:direction*-PageGeometry.landingAngle*progress,
      translateX:0,
      translateZ:lift*Math.min(PageGeometry.liftPixels,width*.022),
      skewY:0,scaleX:1,curlInset:0,curlTail:0,curlRadius:0,
      origin:direction===1?"left center":"right center"};
  }
}
