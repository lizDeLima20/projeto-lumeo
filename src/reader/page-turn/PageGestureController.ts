export interface GestureSample{deltaX:number;velocityX:number;direction:1|-1;}
/** Velocity is read over a short window of recent samples, not between the last two
 *  events. A pointerup almost always lands on the same x as the last pointermove, so the
 *  two-point reading came out as zero on every release: a flick never completed a turn,
 *  and the reader had to drag a third of the page, again and again. A finger that rested
 *  before lifting still reads as zero, because its moving samples age out of the window. */
export class PageGestureController {
  public static readonly windowMs=100;
  private x=0;private samples:{x:number;time:number}[]=[];
  public start(x:number,time:number):void{this.x=x;this.samples=[{x,time}];}
  public update(x:number,time:number):GestureSample{
    this.samples.push({x,time});
    const cutoff=time-PageGestureController.windowMs;
    while(this.samples.length>2&&this.samples[1]!.time<=cutoff)this.samples.shift();
    /* Only samples inside the window count. Keeping the newest sample from before it
       stretched the reading across any stall - one slow frame of 120ms turned a 70px
       flick into 0.19px/ms and the turn fell back. */
    const inside=this.samples.find(sample=>sample.time>=cutoff&&sample!==this.samples[this.samples.length-1]);
    const velocityX=inside?(x-inside.x)/Math.max(1,time-inside.time):0,deltaX=x-this.x;
    return{deltaX,velocityX,direction:deltaX<0?1:-1};
  }
  public finish(x:number,time:number):GestureSample{return this.update(x,time);}
}
