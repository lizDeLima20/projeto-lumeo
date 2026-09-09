export class ReaderLayoutPolicy{
/** The spread breakpoint, stated once. It is the same 48rem the rest of the app uses
 *  for mobile/desktop, and it is expressed in rem so the JS check cannot drift away
 *  from the CSS media query when the reader has changed their browser font size -
 *  a hardcoded 768 would have. In a media query rem resolves against the initial
 *  font size, exactly as the stylesheet's own `min-width:48rem` does. */
public static readonly spreadBreakpointRem=48;
public static readonly spreadBreakpointPx=768;
public static readonly spreadMediaQuery=`(min-width: ${ReaderLayoutPolicy.spreadBreakpointRem}rem)`;
/** True when the viewport is wide enough for two pages side by side. Falls back to
 *  the pixel form where matchMedia is unavailable. */
public spreadFits(view:{matchMedia?:(query:string)=>{matches:boolean};innerWidth:number}):boolean{
  return view.matchMedia?view.matchMedia(ReaderLayoutPolicy.spreadMediaQuery).matches:this.doubleSupported(view.innerWidth);
}
public pageLayout(width:number,preference:"single"|"double",mobileDefault=true):"single"|"double"{if(width<768)return"single";if(width<1024&&mobileDefault)return"single";return preference==="double"?"double":"single";}public doubleSupported(width:number):boolean{return width>=ReaderLayoutPolicy.spreadBreakpointPx;}public rtlSpread(page:number):[number,number]{return[page+1,page];}}
