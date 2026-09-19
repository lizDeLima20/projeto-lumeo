export interface CurlStrip { index:number; along:number; left:number; width:number; bleed:number; x:number; y:number; z:number; angle:number; turned:number; ink:number; shade:number; shadeStart:number; shadeEnd:number; showsBack:boolean; }

const clamp01=(value:number):number=>Math.min(1,Math.max(0,value));

/** A turning leaf is paper, not a plate, and paper turns as a travelling fold.
 *
 *  The reader takes the free edge, so the tip lifts first while the rest still lies on
 *  the page. As the finger moves the fold rolls toward the spine: behind the crest the
 *  paper has already gone over and lies back on itself, showing its verso; ahead of it
 *  the page is still flat. Past vertical the curled tip loses its support and falls,
 *  then settles as the wave moves on. Only when the crest reaches the spine does the
 *  whole leaf lie on the far side.
 *
 *  The crest is placed so the share of paper turned always equals the share of the
 *  gesture done, so the leaf still tracks the drag one to one.
 *
 *  This replaced a bend spread evenly along the leaf. That bend could only reach ~34deg
 *  before the leaf read as warped, so the page looked stiff; and when turned toward
 *  90deg it stood up as a narrow column of text between the two pages. A travelling fold
 *  keeps the flat part flat on its page and gives the roll a real radius. */
export class PageCurlGeometry {
  public static readonly strips = 64;
  /** Half the width of the roll, as a share of the leaf. Smaller is a tighter curl. */
  public static readonly foldHalfWidth = .22;
  /** How far the tip drops as it falls over, in pixels at the free edge. */
  public static readonly sagPixels = 10;
  /** Screen-space bleed each strip needs to close the antialiased crack against its
   *  neighbour, scaled by 1/cos and capped so a strip can never swallow the next. */
  public static readonly screenBleedPixels = 2.8;
  /** Physical overlap between neighbouring visual strip boxes. The mathematical strip
   *  still starts exactly at its original coordinate; PageCurl compensates the transform
   *  origin so this overlap only closes WebView/Chrome subpixel cracks. */
  public static readonly overlapPixels = 3.5;
  public static readonly minShade = 0;
  /** Ambient paper, not a spotlight - but deep enough in the roll that the curve reads
   *  as a surface rather than as a strip of text. */
  public static readonly maxShade = .14;
  /** Below this |cos| a strip is seen at a grazing angle and its type is gone; above the
   *  upper bound it is fully legible. */
  public static readonly inkFadeFrom = .7;
  public static readonly inkFadeTo = .985;

  private memo={progress:Number.NaN,crest:0};
  /** Integral of smoothstep from 0 to u, extended past the roll as a straight line. */
  private static rolled(u:number):number{return u<=0?0:u>=1?u-.5:u*u*u-u*u*u*u/2;}
  /** Share of the whole leaf that has turned while the crest sits at `crest`. */
  public meanTurned(crest:number):number{
    const width=2*PageCurlGeometry.foldHalfWidth,start=crest-PageCurlGeometry.foldHalfWidth;
    return width*(PageCurlGeometry.rolled((1-start)/width)-PageCurlGeometry.rolled(-start/width));
  }
  /** Crest of the fold in leaf coordinates (0 at the spine, 1 at the free edge).
   *
   *  It is placed so the share of paper turned equals the share of the gesture done. A
   *  crest moving linearly does not give that near the ends, where part of the roll hangs
   *  off the leaf: at 20% of the drag only 8% of the paper had turned, so the leaf lagged
   *  the finger and then caught up in a rush. */
  public crestAt(progress:number):number{
    const target=clamp01(progress);
    if(this.memo.progress===target)return this.memo.crest;
    let low=-PageCurlGeometry.foldHalfWidth,high=1+PageCurlGeometry.foldHalfWidth;
    for(let step=0;step<32;step+=1){const middle=(low+high)/2;if(this.meanTurned(middle)>target)low=middle;else high=middle;}
    this.memo={progress:target,crest:(low+high)/2};
    return this.memo.crest;
  }
  /** Share of its full turn a point of the leaf has made: 0 flat, 1 laid over. */
  public turnedAt(progress:number,along:number):number{
    const half=PageCurlGeometry.foldHalfWidth,t=clamp01((along-(this.crestAt(progress)-half))/(2*half));
    return t*t*(3-2*t);
  }
  public angleAt(progress:number,along:number,landingAngle:number,direction:1|-1):number{
    return -direction*landingAngle*this.turnedAt(progress,along);
  }
  /** The tip falling: once past vertical, the part that has gone over sags - most at
   *  135deg and at the free edge, nothing at the spine, nothing once it lies flat. */
  public sagAt(progress:number,along:number):number{
    const turned=this.turnedAt(progress,along);
    return turned<=.5?0:PageCurlGeometry.sagPixels*along*Math.sin(Math.PI*(turned-.5)*2);
  }
  /** A strip square to the reader takes the light; one turned edge-on falls into shadow,
   *  so the darkening sits in the roll itself. */
  public shadeAt(angle:number):number{
    return PageCurlGeometry.maxShade*(1-Math.abs(Math.cos(angle*Math.PI/180)));
  }
  /** Legibility of the print on a strip. Seen edge-on, type is unreadable on real paper;
   *  drawing it anyway squeezed front, back and the page beneath into slivers side by side
   *  at the crest, which read as duplicated, garbled text. The paper itself stays opaque -
   *  only the ink fades. */
  public inkAt(angle:number):number{
    const facing=Math.abs(Math.cos(angle*Math.PI/180));
    const t=clamp01((facing-PageCurlGeometry.inkFadeFrom)/(PageCurlGeometry.inkFadeTo-PageCurlGeometry.inkFadeFrom));
    return t*t*(3-2*t);
  }
  public bleedFor(angle:number,step:number):number{
    const facing=Math.max(.05,Math.abs(Math.cos(angle*Math.PI/180)));
    return Math.min(step*.85,PageCurlGeometry.screenBleedPixels/facing);
  }
  /** Laid out hinge-first: strip 0 is bound to the spine and never moves. */
  public build(progress:number,width:number,landingAngle:number,direction:1|-1,strips=PageCurlGeometry.strips):CurlStrip[]{
    const step=width/strips,out:CurlStrip[]=[];
    let x=0,z=0;
    for(let index=0;index<strips;index+=1){
      const along=(index+.5)/strips,angle=this.angleAt(progress,along,landingAngle,direction),radians=angle*Math.PI/180;
      out.push({index,along,left:index*step,width:step,bleed:this.bleedFor(angle,step),x,y:this.sagAt(progress,along),z,angle,
        turned:this.turnedAt(progress,along),ink:this.inkAt(angle),shade:this.shadeAt(angle),
        shadeStart:this.shadeAt(this.angleAt(progress,index/strips,landingAngle,direction)),
        shadeEnd:this.shadeAt(this.angleAt(progress,(index+1)/strips,landingAngle,direction)),
        showsBack:Math.abs(angle)>90});
      x+=step*Math.cos(radians); z-=step*Math.sin(radians)*direction;
    }
    return out;
  }
}
