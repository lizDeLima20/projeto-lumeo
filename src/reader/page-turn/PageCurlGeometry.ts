export interface CurlStrip { index:number; left:number; width:number; bleed:number; x:number; z:number; angle:number; shade:number; shadeStart:number; shadeEnd:number; showsBack:boolean; }

/** A turning leaf is a developable surface, not a rigid plate. It bends about a
 *  vertical axis, so its tangent angle sweeps along the leaf: the free edge follows
 *  the finger while the part still in the gutter lags behind. The leaf is drawn as a
 *  run of narrow strips laid along that arc.
 *
 *  Two things fall out of the curve that a flat plate cannot give:
 *  - the leaf never disappears. A plate at 90deg projects to zero width, which left
 *    the middle of the gesture with nothing on screen but the cast shadow;
 *  - front and back can show at once, exactly as paper does when it is half over. */
export class PageCurlGeometry {
  /** Flat at rest, flat when it lands, most bent halfway - the shape of a real turn. */
  public static readonly maxBendDegrees = 34;
  public static readonly strips = 18;
  /** Strips overlap by a hair so sub-pixel rounding cannot open a gap between them. */
  public static readonly overlapPixels = 1;
  /** Screen-space bleed each strip needs to close the antialiased crack against its
   *  neighbour. A fixed bleed in the leaf's own space is useless: at 85deg it projects
   *  to a sixth of a pixel, so the seams stayed open exactly where the leaf is most
   *  compressed. Scale it by 1/cos, capped so a strip can never swallow the next. */
  public static readonly screenBleedPixels = 1.6;
  public static readonly minShade = 0;
  public static readonly maxShade = .58;

  public bendAt(progress:number):number{
    return PageCurlGeometry.maxBendDegrees*Math.sin(Math.PI*Math.min(1,Math.max(0,progress)));
  }
  /** Tangent angle at arc position `along` (0 at the hinge, 1 at the free edge). */
  public angleAt(progress:number,along:number,landingAngle:number,direction:1|-1):number{
    return -direction*(landingAngle*progress-this.bendAt(progress)*(1-along));
  }
  /** Lambert-ish: a strip square to the reader takes the lamp, one turned edge-on
   *  falls into shadow. This is where the crease darkening comes from - it is the
   *  geometry shading itself, not a band painted across the page. */
  public shadeAt(angle:number):number{
    const facing=Math.abs(Math.cos(angle*Math.PI/180));
    return PageCurlGeometry.maxShade*(1-facing);
  }
  public bleedFor(angle:number,step:number):number{
    const facing=Math.max(.05,Math.abs(Math.cos(angle*Math.PI/180)));
    return Math.min(step*.85,PageCurlGeometry.screenBleedPixels/facing);
  }
  public build(progress:number,width:number,landingAngle:number,direction:1|-1,strips=PageCurlGeometry.strips):CurlStrip[]{
    const step=width/strips,out:CurlStrip[]=[];
    let x=0,z=0;
    for(let index=0;index<strips;index+=1){
      const angle=this.angleAt(progress,(index+.5)/strips,landingAngle,direction),radians=angle*Math.PI/180;
      /* Shading is sampled at the strip's two EDGES, not once at its middle. A single
         value per strip made every seam a visible step - the banding that read as a
         roll of tape lying across the page. Edge sampling makes the shading continuous
         across the whole arc, so the strips stop being findable. */
      out.push({index,left:index*step,width:step,bleed:this.bleedFor(angle,step),x,z,angle,shade:this.shadeAt(angle),
        shadeStart:this.shadeAt(this.angleAt(progress,index/strips,landingAngle,direction)),
        shadeEnd:this.shadeAt(this.angleAt(progress,(index+1)/strips,landingAngle,direction)),
        showsBack:Math.abs(angle)>90});
      x+=step*Math.cos(radians); z-=step*Math.sin(radians);
    }
    return out;
  }
}
