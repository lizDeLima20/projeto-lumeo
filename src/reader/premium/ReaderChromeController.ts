export interface ReaderChromeState{visible:boolean;focusMode:boolean;progressVisible:boolean;}
export class ReaderChromeController{
  private timer=0;private stateValue:ReaderChromeState={visible:true,focusMode:false,progressVisible:true};
  public constructor(private readonly apply:(state:ReaderChromeState)=>void,private readonly setTimer:(action:()=>void,ms:number)=>number=(action,ms)=>window.setTimeout(action,ms),private readonly clearTimer:(id:number)=>void=id=>window.clearTimeout(id),private readonly idleMs=3300){}
  public get state():Readonly<ReaderChromeState>{return this.stateValue;}
  public show(temporary=true):void{this.stateValue={...this.stateValue,visible:true};this.apply(this.stateValue);if(temporary)this.schedule();}
  public hide():void{if(this.stateValue.focusMode)return;this.clearTimer(this.timer);this.stateValue={...this.stateValue,visible:false};this.apply(this.stateValue);}
  public neutralTap():void{this.show(true);}
  public selectionStarted():void{this.clearTimer(this.timer);}
  public setFocusMode(active:boolean):void{this.clearTimer(this.timer);this.stateValue={...this.stateValue,focusMode:active,visible:!active,progressVisible:!active&&this.stateValue.progressVisible};this.apply(this.stateValue);}
  public setProgressVisible(visible:boolean):void{this.stateValue={...this.stateValue,progressVisible:visible};this.apply(this.stateValue);}
  public schedule():void{this.clearTimer(this.timer);this.timer=this.setTimer(()=>this.hide(),this.idleMs);}
  public destroy():void{this.clearTimer(this.timer);}
}
