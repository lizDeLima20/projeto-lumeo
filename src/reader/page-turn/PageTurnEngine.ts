import{PageGeometry,type PageTransform}from"./PageGeometry";import{PageGestureController}from"./PageGestureController";import{PageShadowRenderer}from"./PageShadowRenderer";import{PageCurl}from"./PageCurl";
export type PageTurnState="IDLE"|"DRAGGING"|"COMPLETING"|"RETURNING"|"DISABLED";export type TurnDirection=1|-1;

/** Cubic-bezier sampled by hand: the settle now drives `progress` frame by frame so
 *  the leaf can bend on the way, which a single WAAPI transform tween cannot express. */
export function easeProgress(a:number,b:number,c:number,d:number,t:number):number{
  let low=0,high=1,guess=t;
  const bezier=(p1:number,p2:number,u:number)=>{const v=1-u;return 3*v*v*u*p1+3*v*u*u*p2+u*u*u;};
  for(let step=0;step<18;step+=1){const x=bezier(a,c,guess);if(Math.abs(x-t)<1e-4)break;x<t?low=guess:high=guess;guess=(low+high)/2;}
  return bezier(b,d,guess);
}

export class PageTurnEngine {
  public static readonly settleEasing="cubic-bezier(.22,.61,.36,1)";
  public static readonly settleCurve=[.22,.61,.36,1] as const;
  /** Long enough to read the leaf finishing, short enough not to feel stuck. */
  public static readonly completeMs=[500,800] as const;
  public static readonly restoreMs=[350,600] as const;
  /** A flick finishes the turn on its own - the range touch readers use (~0.3-0.4 px/ms).
   *  .55px/ms was faster than most thumbs swipe. */
  public static readonly flickVelocity=.3;
  private stateValue:PageTurnState="IDLE";private readonly gesture=new PageGestureController();
  private frame=0;private pending:PageTransform|null=null;private velocity=0;private direction:TurnDirection=1;
  public constructor(private readonly page:HTMLElement,private readonly under:HTMLElement|null,private readonly commit:(direction:TurnDirection)=>void,private readonly geometry=new PageGeometry(),private readonly shadows=new PageShadowRenderer(),private readonly threshold=.3,private readonly curl=new PageCurl()){}

  public get state():PageTurnState{return this.stateValue;}
  public begin(x:number,time=performance.now()):boolean{
    if(this.stateValue!=="IDLE")return false;
    this.stateValue="DRAGGING";this.gesture.start(x,time);
    this.page.classList.add("page-turn-active");this.page.style.willChange="transform";
    this.curl.mount(this.page);
    return true;
  }
  public move(x:number,time=performance.now()):number{
    if(this.stateValue!=="DRAGGING")return 0;
    const sample=this.gesture.update(x,time);this.direction=sample.direction;this.velocity=sample.velocityX;
    this.pending=this.geometry.calculate(sample.deltaX,this.page.clientWidth,this.direction);
    this.schedule();return this.pending.progress;
  }
  public async end(x:number,time=performance.now()):Promise<boolean>{
    if(this.stateValue!=="DRAGGING")return false;
    const sample=this.gesture.finish(x,time);this.direction=sample.direction;this.velocity=sample.velocityX;
    const transform=this.geometry.calculate(sample.deltaX,this.page.clientWidth,this.direction);
    this.apply(transform);
    const complete=this.shouldComplete(transform.progress,this.velocity,this.direction);
    await this.settle(complete,transform);
    if(complete)this.commit(this.direction);
    this.reset();return complete;
  }
  public cancel():Promise<void>{
    if(this.stateValue!=="DRAGGING")return Promise.resolve();
    const current=this.pending??this.geometry.calculate(0,this.page.clientWidth,this.direction);
    return this.settle(false,current).then(()=>this.reset());
  }
  public shouldComplete(progress:number,velocityX:number,direction:TurnDirection):boolean{
    return progress>=this.threshold||Math.abs(velocityX)>=PageTurnEngine.flickVelocity&&(direction===1?velocityX<0:velocityX>0);
  }
  public async programmatic(direction:TurnDirection):Promise<boolean>{
    if(!this.begin(direction===1?this.page.clientWidth:0))return false;
    this.direction=direction;
    const start=this.geometry.atProgress(.08,this.page.clientWidth,direction);
    this.apply(start);await this.settle(true,start);this.commit(direction);this.reset();return true;
  }
  public disable():void{this.stateValue="DISABLED";}

  private schedule():void{
    if(this.frame)return;
    this.frame=requestAnimationFrame(()=>{this.frame=0;if(this.pending)this.apply(this.pending)});
  }
  private apply(value:PageTransform):void{
    this.page.classList.toggle("page-turn--next",this.direction===1);
    this.page.classList.toggle("page-turn--previous",this.direction===-1);
    if(this.curl.mounted)this.curl.apply(value.progress,PageGeometry.landingAngle,this.direction);
    else{this.page.style.transformOrigin=value.origin;this.page.style.transform=`translateX(${value.translateX}px) translateZ(${value.translateZ}px) rotateY(${value.angle}deg)`;}
    this.shadows.render(this.page,this.under,value);
  }
  /** Swings the leaf to its landing angle (or back to the gutter) and STOPS there.
   *  Clearing is deliberately left to reset(), which runs only after the new spread has
   *  been committed - otherwise the leaf snapped back to 0deg still carrying the old
   *  page for one frame, which read as a flicker. */
  private settle(complete:boolean,current:PageTransform):Promise<void>{
    this.stateValue=complete?"COMPLETING":"RETURNING";
    cancelAnimationFrame(this.frame);this.frame=0;
    const from=current.progress,to=complete?1:0;
    /* The finishing move is deliberately unhurried: the reader has to see the leaf let
       go of the gutter, sag and leave. Duration scales with how far is left to go. */
    const span=complete?PageTurnEngine.completeMs:PageTurnEngine.restoreMs;
    const duration=span[0]+(span[1]-span[0])*Math.min(1,Math.abs(to-from));
    const width=this.page.clientWidth||1;
    if(typeof requestAnimationFrame!=="function")return Promise.resolve();
    return new Promise(resolve=>{
      const started=performance.now();
      const step=()=>{
        const t=Math.min(1,(performance.now()-started)/duration);
        const eased=easeProgress(...PageTurnEngine.settleCurve,t);
        this.apply(this.geometry.atProgress(from+(to-from)*eased,width,this.direction));
        if(t<1){this.frame=requestAnimationFrame(step);return;}
        this.frame=0;resolve();
      };
      this.frame=requestAnimationFrame(step);
    });
  }
  private reset():void{
    this.curl.unmount();
    this.page.style.transform="";this.page.style.transformOrigin="";this.page.style.willChange="";
    this.page.classList.remove("page-turn-active","page-turn--next","page-turn--previous");
    this.shadows.clear(this.page,this.under);this.stateValue="IDLE";
  }
}
