/** Decides whether a pointer that went down is actually trying to turn a leaf.
 *
 *  Shared by both readers so forward and back behave identically: a few pixels of slop
 *  before anything moves, and a horizontal bias so a vertical drag does not peel the
 *  page sideways by accident. */
export class PageGestureIntent {
  public static readonly slopPixels=8;
  public static readonly horizontalBias=1.2;
  public static readonly interactiveSelector="a,button,input,textarea,select,label,[contenteditable],[data-highlight-id]";
  private startX=0;private startY=0;private live=false;private armedValue=false;

  /** Touch turns a page from anywhere, text included. On a phone the text IS the page:
   *  refusing any press that landed on a paragraph left only the margins to swipe on, so
   *  most swipes did nothing. A mouse press on text still selects instead, because the
   *  desktop has the arrows, the keys and the gutter to turn with. */
  public static startsTurn(event:{button:number;pointerType?:string;target:EventTarget|null}):boolean{
    if(event.button!==0)return false;
    const target=typeof Element!=="undefined"&&event.target instanceof Element?event.target:null;
    if(target?.closest(PageGestureIntent.interactiveSelector))return false;
    if(event.pointerType==="mouse"&&target?.closest("[data-block-id]"))return false;
    const selection=typeof getSelection==="function"?getSelection():null;
    if(selection&&!selection.isCollapsed&&selection.toString().trim())return false;
    return true;
  }

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
