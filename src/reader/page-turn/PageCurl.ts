interface SurfaceNodes{host:HTMLElement;surface:HTMLElement;front:HTMLElement;back:HTMLElement;}

/** Draws the turning leaf as one continuous physical sheet.
 *
 * The previous implementation sliced the page into vertical strips to fake curvature.
 * On Android WebView/Chrome those slices became visible as seams, flicker and transparent
 * gaps. This renderer keeps a single opaque surface with two real faces. The curvature is
 * suggested by continuous transforms and shadows on the whole sheet, never by separate
 * visible bands. */
export class PageCurl {
  public static readonly surfaceClass="page-turn-surface";
  private nodes:SurfaceNodes|null=null;
  private width=0;
  private padding="";

  public get mounted():boolean{return this.nodes!==null;}

  public mount(page:HTMLElement):void{
    if(this.nodes)this.unmount();
    this.width=page.clientWidth;
    if(!this.width||typeof document==="undefined"||!page.children)return;
    this.padding=typeof getComputedStyle==="function"?getComputedStyle(page).padding:"";
    const frontSource=[...page.children].filter(child=>!child.classList.contains("page-turn-verso"));
    const verso=page.querySelector<HTMLElement>(".page-turn-verso");
    const backSource=verso?[...(verso.firstElementChild?.children??verso.children)]:[];
    const host=this.element("page-turn-curl"),surface=this.element(PageCurl.surfaceClass);
    const front=this.face("front",frontSource),back=this.face("back",backSource);
    surface.append(front,back);host.append(surface);page.append(host);
    this.nodes={host,surface,front,back};page.classList.add("page-turn-curled");
  }

  private face(face:"front"|"back",source:readonly Element[]):HTMLElement{
    const node=this.element(`page-turn-surface__${face}`);
    const inner=this.element("page-turn-surface__inner");
    if(this.padding)inner.style.padding=this.padding;
    source.forEach(child=>inner.append(child.cloneNode(true)));
    node.append(inner);return node;
  }

  private element(className:string):HTMLElement{const node=document.createElement("div");node.className=className;return node;}

  public apply(progress:number,landingAngle:number,direction:1|-1):void{
    if(!this.nodes)return;
    const p=Math.min(1,Math.max(0,progress));
    const angle=-direction*landingAngle*p;
    const lift=Math.sin(p*Math.PI);
    const bend=Math.sin(p*Math.PI)*direction;
    const origin=direction===1?"0 50%":"100% 50%";
    const freeEdgeRadius=Math.max(0,Math.sin(p*Math.PI))*18;
    const compress=1-Math.sin(p*Math.PI)*.035;
    this.nodes.host.style.setProperty("--curl-progress",p.toFixed(3));
    this.nodes.host.style.setProperty("--curl-lift",lift.toFixed(3));
    this.nodes.host.style.setProperty("--curl-direction",String(direction));
    this.nodes.host.style.setProperty("--curl-edge-radius",`${freeEdgeRadius.toFixed(2)}px`);
    const surface=this.nodes.surface.style;
    surface.transformOrigin=origin;
    surface.transform=[
      `translateZ(${(lift*28).toFixed(2)}px)`,
      `rotateY(${angle.toFixed(3)}deg)`,
      `skewY(${(bend*1.2).toFixed(3)}deg)`,
      `scaleX(${compress.toFixed(4)})`,
    ].join(" ");
    this.nodes.surface.classList.toggle("page-turn-surface--next",direction===1);
    this.nodes.surface.classList.toggle("page-turn-surface--previous",direction===-1);
    this.nodes.surface.classList.toggle("page-turn-surface--back-visible",Math.abs(angle)>90);
  }

  public static place():{left:number;origin:string;shiftX:number;angle:number;shadeLeft:number;shadeRight:number}{
    return{left:0,origin:"0 50%",shiftX:0,angle:0,shadeLeft:0,shadeRight:0};
  }

  public unmount():void{
    this.nodes?.host.parentElement?.classList.remove("page-turn-curled");
    this.nodes?.host.remove();this.nodes=null;
  }
}
