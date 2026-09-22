interface SurfaceNodes{host:HTMLElement;surface:HTMLElement;front:HTMLElement;back:HTMLElement;mesh:HTMLElement;lip:HTMLElement;lipFront:HTMLElement;lipBack:HTMLElement;bow:HTMLElement;isCover:boolean;}

/** One opaque leaf. The curved edge and bow are continuous overlays, never page strips. */
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
    const isCover=page.classList.contains("reflow-sheet--cover")||page.classList.contains("open-book-page--cover");
    const host=this.element("page-turn-curl"),surface=this.element(PageCurl.surfaceClass),mesh=this.element("page-turn-rib-mesh"),lip=this.element("page-turn-curl-lip"),bow=this.element("page-turn-curl-bow");
    const front=this.face("front",frontSource),back=this.face("back",backSource);
    const lipFront=this.face("lip-front",frontSource),lipBack=this.face("lip-back",backSource);
    lip.append(lipFront,lipBack);surface.append(front,back,mesh,bow,lip);host.append(surface);page.append(host);
    surface.classList.remove("page-turn-surface--mesh");
    this.nodes={host,surface,front,back,mesh,lip,lipFront,lipBack,bow,isCover};page.classList.add("page-turn-curled");
  }

  private face(face:"front"|"back"|"lip-front"|"lip-back",source:readonly Element[]):HTMLElement{
    const node=this.element(face.startsWith("lip-")?`page-turn-curl-lip__${face.slice(4)}`:`page-turn-surface__${face}`);
    const inner=this.element("page-turn-surface__inner");
    inner.style.width=`${this.width}px`;
    if(this.padding)inner.style.padding=this.padding;
    if(!face.startsWith("lip-"))source.forEach(child=>inner.append(child.cloneNode(true)));
    node.append(inner);return node;
  }

  private element(className:string):HTMLElement{const node=document.createElement("div");node.className=className;return node;}

  public apply(progress:number,landingAngle:number,direction:1|-1):void{
    if(!this.nodes)return;
    const p=Math.min(1,Math.max(0,progress)),angle=-direction*landingAngle*p,lift=Math.sin(p*Math.PI);
    const flexible=this.nodes.isCover?0:1,bend=Math.sin(p*Math.PI)*direction*flexible;
    const origin=direction===1?"0 50%":"100% 50%";
    const freeEdgeRadius=Math.max(0,Math.sin(p*Math.PI))*(this.nodes.isCover?4:72);
    const compress=1-Math.sin(p*Math.PI)*(this.nodes.isCover?.008:.045);
    const lipWidth=Math.max(62,Math.min(this.width*.42,this.width*(.18+lift*.2))),lipOverlap=Math.min(14,lipWidth*.2);
    const lipLeft=direction===1?this.width-lipWidth-lipOverlap:0,lipRotation=-direction*lift*(this.nodes.isCover?8:76);
    const bowWidth=Math.max(110,Math.min(this.width*.68,this.width*(.36+lift*.25))),bowLeft=direction===1?this.width-bowWidth:0;
    this.nodes.host.style.setProperty("--curl-progress",p.toFixed(3));this.nodes.host.style.setProperty("--curl-lift",lift.toFixed(3));this.nodes.host.style.setProperty("--curl-direction",String(direction));
    this.nodes.host.style.setProperty("--curl-edge-radius",`${freeEdgeRadius.toFixed(2)}px`);this.nodes.host.style.setProperty("--curl-lip-scale",this.nodes.isCover?"0":Math.max(.08,lift).toFixed(3));
    this.nodes.host.style.setProperty("--curl-bow-width",`${bowWidth.toFixed(2)}px`);this.nodes.host.style.setProperty("--curl-bow-left",`${bowLeft.toFixed(2)}px`);
    const surface=this.nodes.surface.style;surface.transformOrigin=origin;
    surface.transform=[`translateZ(${(lift*(this.nodes.isCover?14:34)).toFixed(2)}px)`,`rotateY(${angle.toFixed(3)}deg)`,`rotateX(${(Math.abs(bend)*(this.nodes.isCover?-2.2:-6.5)).toFixed(3)}deg)`,`skewY(${(bend*(this.nodes.isCover?2.1:5.8)).toFixed(3)}deg)`,`scaleX(${compress.toFixed(4)})`].join(" ");
    const bowStyle=this.nodes.bow.style;bowStyle.left=`${bowLeft.toFixed(2)}px`;bowStyle.width=`${bowWidth.toFixed(2)}px`;bowStyle.transformOrigin=direction===1?"100% 50%":"0 50%";
    bowStyle.transform=[`translateZ(${(lift*10+.5).toFixed(2)}px)`,`rotateY(${(-direction*lift*32).toFixed(3)}deg)`,`skewY(${(bend*2.4).toFixed(3)}deg)`].join(" ");
    const lipStyle=this.nodes.lip.style;lipStyle.left=`${lipLeft.toFixed(2)}px`;lipStyle.width=`${(lipWidth+lipOverlap).toFixed(2)}px`;lipStyle.transformOrigin=direction===1?"0 50%":"100% 50%";
    lipStyle.transform=[`translateZ(${(lift*18+1).toFixed(2)}px)`,`rotateY(${lipRotation.toFixed(3)}deg)`,`skewY(${(bend*3.2).toFixed(3)}deg)`,`scaleX(var(--curl-lip-scale))`].join(" ");
    this.nodes.lipFront.querySelector<HTMLElement>(".page-turn-surface__inner")!.style.transform=`translateX(${-lipLeft}px)`;
    this.nodes.lipBack.querySelector<HTMLElement>(".page-turn-surface__inner")!.style.transform=`translateX(${-lipLeft}px)`;
    this.nodes.surface.classList.toggle("page-turn-surface--next",direction===1);this.nodes.surface.classList.toggle("page-turn-surface--previous",direction===-1);this.nodes.surface.classList.toggle("page-turn-surface--back-visible",Math.abs(angle)>90);this.nodes.surface.classList.toggle("page-turn-surface--cover",this.nodes.isCover);
  }

  public static place():{left:number;origin:string;shiftX:number;angle:number;shadeLeft:number;shadeRight:number}{return{left:0,origin:"0 50%",shiftX:0,angle:0,shadeLeft:0,shadeRight:0};}
  public unmount():void{this.nodes?.host.parentElement?.classList.remove("page-turn-curled");this.nodes?.host.remove();this.nodes=null;}
}
