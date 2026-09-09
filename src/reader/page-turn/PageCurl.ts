import{PageCurlGeometry,type CurlStrip}from"./PageCurlGeometry";

/** Draws the leaf as a bent surface. The page's own content is cloned into a run of
 *  strips laid along the arc; each strip carries the matching band of the front and,
 *  mirrored, of the back, and shows whichever one it is facing the reader with.
 *
 *  Clipping lives on the strips rather than on the leaf, because `overflow` on the
 *  leaf would force `transform-style` back to flat and collapse the whole arc. */
export class PageCurl {
  public static readonly stripClass="page-turn-strip";
  private strips:HTMLElement[]=[];
  private host:HTMLElement|null=null;
  private width=0;
  private padding="";
  public constructor(private readonly geometry=new PageCurlGeometry()){}

  public get mounted():boolean{return this.host!==null;}

  public mount(page:HTMLElement,count=PageCurlGeometry.strips):void{
    if(this.host)this.unmount();
    /* Bail out where there is no DOM to build into, or no width to slice: the engine
       then falls back to moving the leaf as a single plane. */
    this.width=page.clientWidth;
    if(!this.width||typeof document==="undefined"||!page.children)return;
    /* The clones lose the page's own box, so its padding is carried over verbatim -
       otherwise the type would sit flush against the strip's clipping edge. */
    this.padding=typeof getComputedStyle==="function"?getComputedStyle(page).padding:"";
    const front=[...page.children].filter(child=>!child.classList.contains("page-turn-verso"));
    /* The verso wraps its page in a full page box of its own. Cloning that box would
       apply the page padding twice - the type ended up in a small panel floating
       inside the leaf. Take its children, exactly as the front side does. */
    const verso=page.querySelector<HTMLElement>(".page-turn-verso");
    const versoContent=verso?[...(verso.firstElementChild?.children??verso.children)]:[];
    const host=document.createElement("div");host.className="page-turn-curl";host.setAttribute("aria-hidden","true");
    const step=this.width/count;
    for(let index=0;index<count;index+=1){
      const strip=document.createElement("div");strip.className=PageCurl.stripClass;
      strip.style.width=`${step}px`;strip.style.left=`${index*step}px`;
      strip.append(this.band("front",front,-index*step,this.width),
        this.band("back",versoContent,-index*step,this.width));
      host.append(strip);this.strips.push(strip);
    }
    page.append(host);this.host=host;page.classList.add("page-turn-curled");
  }

  /** One band of the leaf: a full-width copy of the content slid sideways so that only
   *  this strip's slice shows through the strip's own clipping. */
  private band(face:"front"|"back",source:readonly Element[],offset:number,width:number):HTMLElement{
    const band=this.element(`page-turn-strip__${face}`);

    const inner=this.element("page-turn-strip__inner");
    inner.style.width=`${width}px`;
    /* Mirroring happens on the CONTENT, not on the band. Flipping the band left the
       anti-seam bleed outside the mirrored box, which reopened every seam on the verso
       as a bright hairline; the inner is a fixed full-width box, so its mirror axis
       never moves. */
    inner.style.transform=face==="back"?`translateX(${offset}px) scaleX(-1)`:`translateX(${offset}px)`;
    if(this.padding)inner.style.padding=this.padding;
    source.forEach(child=>inner.append(child.cloneNode(true)));
    band.append(inner);return band;
  }
  private element(className:string):HTMLElement{const node=document.createElement("div");node.className=className;return node;}

  /** The whole leaf drifts, sags, tilts and shrinks as one once it leaves the gutter;
   *  only the bend is per strip. Pivoting on the hinge, not on the leaf's middle. */
  public settleHost(value:{flyX:number;flyY:number;tilt:number;scale:number},direction:1|-1):void{
    if(!this.host)return;
    this.host.style.transformOrigin=direction===1?"0 50%":"100% 50%";
    this.host.style.transform=`translate3d(${value.flyX.toFixed(2)}px,${value.flyY.toFixed(2)}px,0) rotateZ(${value.tilt.toFixed(3)}deg) scale(${value.scale.toFixed(4)})`;
  }
  public apply(progress:number,landingAngle:number,direction:1|-1):CurlStrip[]{
    const plan=this.geometry.build(progress,this.width,landingAngle,direction,this.strips.length);
    plan.forEach(strip=>{
      const node=this.strips[strip.index];if(!node)return;
      node.style.width=`${strip.width+strip.bleed}px`;
      node.style.transform=`translate3d(${strip.x-strip.left}px,0,${strip.z}px) rotateY(${strip.angle}deg)`;
      node.style.setProperty("--strip-shade-a",strip.shadeStart.toFixed(3));
      node.style.setProperty("--strip-shade-b",strip.shadeEnd.toFixed(3));
      node.dataset.face=strip.showsBack?"back":"front";
    });
    return plan;
  }

  public unmount():void{
    this.host?.parentElement?.classList.remove("page-turn-curled");
    this.host?.remove();this.host=null;this.strips=[];
  }
}
