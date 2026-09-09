export interface PageTransform {progress:number;angle:number;translateX:number;translateZ:number;skewY:number;scaleX:number;curlInset:number;curlTail:number;curlRadius:number;origin:string;release:number;flyX:number;flyY:number;tilt:number;scale:number;}

/** How far the leaf has come, and what it does once it starts to lose its grip on the
 *  gutter. Angle and bend live in PageCurlGeometry; this is the gesture side. */
export class PageGeometry {
  public static readonly landingAngle=178;
  public static readonly liftPixels=14;
  /** The finger has to travel further than the page is wide to finish a turn. At 1.0
   *  the leaf was over before the reader could see it bend, pass the halfway point and
   *  show its back. */
  public static readonly dragSpanFactor=1.3;
  /** Where the leaf stops being held by the gutter and starts to fall away. */
  public static readonly releaseAt=.68;
  public static readonly flyPixels=70;
  public static readonly gravityPixels=12;
  public static readonly tiltDegrees=1.2;
  public static readonly shrinkAtRelease=.025;
  /** The leaf tracks the finger one-to-one: no easing while the gesture is live. */
  public static readonly tracksPointerLinearly=true;
  public static readonly keepsPerfectRectangle=true;

  public progressFor(deltaX:number,width:number):number{
    return Math.min(1,Math.max(0,Math.abs(deltaX)/Math.max(1,width*PageGeometry.dragSpanFactor)));
  }
  /** Distance the finger must still cover to reach a given progress - the inverse of
   *  progressFor, so the settle can drive the same geometry the drag does. */
  public distanceFor(progress:number,width:number):number{
    return progress*width*PageGeometry.dragSpanFactor;
  }
  public calculate(deltaX:number,width:number,direction:1|-1):PageTransform{
    return this.atProgress(this.progressFor(deltaX,width),width,direction);
  }
  public atProgress(progress:number,width:number,direction:1|-1):PageTransform{
    const curl=Math.sin(progress*Math.PI);
    /* Past releaseAt the leaf is no longer supported by the gutter: it drifts outward,
       sags under its own small weight and shrinks a hair as it goes. All of it stays
       subtle - the leaf leaves, it is not thrown. */
    const release=Math.min(1,Math.max(0,(progress-PageGeometry.releaseAt)/(1-PageGeometry.releaseAt)));
    return{progress,
      angle:direction*-PageGeometry.landingAngle*progress,
      translateX:0,
      translateZ:curl*Math.min(PageGeometry.liftPixels,width*.022),
      skewY:0,scaleX:1,curlInset:0,curlTail:0,curlRadius:0,
      release,
      flyX:direction*-release*PageGeometry.flyPixels,
      flyY:release*release*PageGeometry.gravityPixels,
      tilt:direction*-curl*PageGeometry.tiltDegrees,
      scale:1-release*PageGeometry.shrinkAtRelease,
      origin:direction===1?"left center":"right center"};
  }
}
