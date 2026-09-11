export interface PageTransform {progress:number;angle:number;translateX:number;translateZ:number;skewY:number;scaleX:number;curlInset:number;curlTail:number;curlRadius:number;origin:string;release:number;flyX:number;flyY:number;tilt:number;scale:number;}

/** How far the leaf has come for a given drag. Angle, fold and sag live in
 *  PageCurlGeometry; this is the gesture side. */
export class PageGeometry {
  public static readonly landingAngle=178;
  public static readonly liftPixels=14;
  /** On a spread the finger travels further than the page is wide, so the reader sees the
   *  leaf fold, cross over and show its back. */
  public static readonly dragSpanFactor=1.3;
  /** On a phone the screen IS the page. A 1.3x span asked for 535px of drag on a 412px
   *  screen - more than any swipe can give - so a single turn took several swipes. */
  public static readonly singlePageSpanFactor=.9;
  public static readonly releaseAt=.68;
  public static readonly tracksPointerLinearly=true;
  public static readonly keepsPerfectRectangle=true;
  /** The leaf as a whole never travels: the spine stays exactly where the book put it.
   *  The drop at the end belongs to the curled tip and is drawn per strip. Translating the
   *  whole leaf moved the hinge with it. */
  public static readonly movesWholeLeaf=false;

  public constructor(public readonly span=PageGeometry.dragSpanFactor){}

  public progressFor(deltaX:number,width:number):number{
    return Math.min(1,Math.max(0,Math.abs(deltaX)/Math.max(1,width*this.span)));
  }
  /** Inverse of progressFor, so the settle drives the same geometry the drag does. */
  public distanceFor(progress:number,width:number):number{
    return progress*width*this.span;
  }
  public calculate(deltaX:number,width:number,direction:1|-1):PageTransform{
    return this.atProgress(this.progressFor(deltaX,width),width,direction);
  }
  public atProgress(progress:number,width:number,direction:1|-1):PageTransform{
    const curl=Math.sin(progress*Math.PI);
    const release=Math.min(1,Math.max(0,(progress-PageGeometry.releaseAt)/(1-PageGeometry.releaseAt)));
    return{progress,
      angle:direction*-PageGeometry.landingAngle*progress,
      translateX:0,
      translateZ:curl*Math.min(PageGeometry.liftPixels,width*.022),
      skewY:0,scaleX:1,curlInset:0,curlTail:0,curlRadius:0,
      release,flyX:0,flyY:0,tilt:0,scale:1,
      origin:direction===1?"left center":"right center"};
  }
}
