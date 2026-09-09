/** Decides whether a pointer that went down is actually trying to turn a leaf.
 *
 *  Two guards, shared by both readers so forward and back behave identically:
 *  a few pixels of slop before anything moves, which stops the leaf twitching under a
 *  resting finger or a click; and a horizontal bias, so a reader scrolling down the
 *  page does not peel it sideways by accident. */
export class PageGestureIntent {
  public static readonly slopPixels=8;
  public static readonly horizontalBias=1.2;
  private startX=0;private startY=0;private live=false;private armedValue=false;
  public arm(x:number,y:number):void{this.startX=x;this.startY=y;this.live=true;this.armedValue=false;}
  public get armed():boolean{return this.armedValue;}
  public get active():boolean{return this.live;}
  public get origin():number{return this.startX;}
  public deltaX(x:number):number{return x-this.startX;}
  /** True on the frame the gesture is recognised, and on every frame after it. */
  public accepts(x:number,y:number):boolean{
    if(!this.live)return false;
    if(this.armedValue)return true;
    const dx=x-this.startX,dy=y-this.startY;
    if(Math.abs(dx)<PageGestureIntent.slopPixels)return false;
    if(Math.abs(dx)<=Math.abs(dy)*PageGestureIntent.horizontalBias)return false;
    this.armedValue=true;return true;
  }
  public release():void{this.live=false;this.armedValue=false;}
}
