import{PageCurlGeometry,type CurlStrip}from"./PageCurlGeometry";

interface StripNodes{root:HTMLElement;front:HTMLElement;back:HTMLElement;}

/** Draws the leaf as a folding surface. The page's content is cloned into a run of
 *  strips; each carries the matching slice of the front and, mirrored, of the back, and
 *  shows whichever face it turns toward the reader.
 *
 *  Clipping lives on the strips rather than on the leaf, because `overflow` on the leaf
 *  would force `transform-style` back to flat and collapse the fold. */
export class PageCurl {
  public static readonly stripClass="page-turn-strip";
  private strips:StripNodes[]=[];
  private host:HTMLElement|null=null;
  private width=0;
  private padding="";
  public constructor(private readonly geometry=new PageCurlGeometry()){}

  public get mounted():boolean{return this.host!==null;}

  public mount(page:HTMLElement,count=PageCurlGeometry.strips):void{
    if(this.host)this.unmount();
    /* No DOM to build into, or no width to slice: the engine then moves the leaf as a
       single plane. */
    this.width=page.clientWidth;
    if(!this.width||typeof document==="undefined"||!page.children)return;
    /* The clones lose the page's own box, so its padding is carried over verbatim. */
    this.padding=typeof getComputedStyle==="function"?getComputedStyle(page).padding:"";
    const front=[...page.children].filter(child=>!child.classList.contains("page-turn-verso"));
    /* The verso wraps its page in a page box of its own; cloning that box would apply the
       padding twice. Take its children, exactly as the front does. */
    const verso=page.querySelector<HTMLElement>(".page-turn-verso");
    const versoContent=verso?[...(verso.firstElementChild?.children??verso.children)]:[];
    const host=document.createElement("div");host.className="page-turn-curl";host.setAttribute("aria-hidden","true");
    for(let index=0;index<count;index+=1){
      const root=document.createElement("div");root.className=PageCurl.stripClass;
      const front$=this.band("front",front),back$=this.band("back",versoContent);
      root.append(front$.band,back$.band);host.append(root);
      this.strips.push({root,front:front$.inner,back:back$.inner});
    }
    page.append(host);this.host=host;page.classList.add("page-turn-curled");
  }

  /** One band of the leaf: a full-width copy of the content, slid sideways in apply() so
   *  only this strip's slice shows through the strip's clipping. */
  private band(face:"front"|"back",source:readonly Element[]):{band:HTMLElement;inner:HTMLElement}{
    const band=this.element(`page-turn-strip__${face}`),inner=this.element("page-turn-strip__inner");
    inner.style.width=`${this.width}px`;
    if(this.padding)inner.style.padding=this.padding;
    source.forEach(child=>inner.append(child.cloneNode(true)));
    band.append(inner);return{band,inner};
  }
  private element(className:string):HTMLElement{const node=document.createElement("div");node.className=className;return node;}

  /** The hinge is on the side the leaf is bound: its left edge going forward, its right
   *  edge going back. For a while it was the left edge both ways, so a backward turn swung
   *  the leaf about its OUTER edge, into the screen and out of sight - turning back simply
   *  did nothing. The plan is computed hinge-first and laid onto whichever edge is bound,
   *  with the anti-seam bleed always growing away from the hinge. */
  public apply(progress:number,landingAngle:number,direction:1|-1):CurlStrip[]{
    const count=this.strips.length;
    const plan=this.geometry.build(progress,this.width,landingAngle,1,count);
    for(let slot=0;slot<count;slot+=1){
      const nodes=this.strips[slot]!,strip=plan[direction===1?slot:count-1-slot]!;
      const{left,origin,shiftX,angle,shadeLeft,shadeRight}=PageCurl.place(strip,slot,count,this.width,direction);
      const root=nodes.root.style;
      root.left=`${left}px`;root.width=`${this.width/count+strip.bleed}px`;root.transformOrigin=origin;
      root.transform=`translate3d(${shiftX}px,${strip.y}px,${strip.z}px) rotateY(${angle}deg)`;
      nodes.root.style.setProperty("--strip-shade-a",shadeLeft.toFixed(3));
      nodes.root.style.setProperty("--strip-shade-b",shadeRight.toFixed(3));
      nodes.root.style.setProperty("--strip-ink",strip.ink.toFixed(3));
      /* The faces are real planes. The back rotates with the paper itself; using
       * display:none to swap cloned text at 90deg was what made the sheet look like a
       * transparent card on some desktop compositors. */
      nodes.front.style.transform=`translateX(${-left}px)`;
      nodes.back.style.transform=`translateX(${-left}px) rotateY(180deg)`;
    }
    return plan;
  }

  /** Where one strip goes on the element, for a leaf bound on its left edge (forward) or
   *  its right edge (back). Pure, so the hinge rule can be tested without a DOM. */
  public static place(strip:CurlStrip,slot:number,count:number,width:number,direction:1|-1):{left:number;origin:string;shiftX:number;angle:number;shadeLeft:number;shadeRight:number}{
    const step=width/count;
    if(direction===1)return{left:slot*step,origin:"0 50%",shiftX:strip.x-slot*step,angle:strip.angle,shadeLeft:strip.shadeStart,shadeRight:strip.shadeEnd};
    return{left:slot*step-strip.bleed,origin:"100% 50%",shiftX:(width-strip.x)-(slot+1)*step,angle:-strip.angle,shadeLeft:strip.shadeEnd,shadeRight:strip.shadeStart};
  }

  public unmount():void{
    this.host?.parentElement?.classList.remove("page-turn-curled");
    this.host?.remove();this.host=null;this.strips=[];
  }
}
