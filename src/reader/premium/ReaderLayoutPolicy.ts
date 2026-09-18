export class ReaderLayoutPolicy{
/** The spread breakpoint, stated once. It is the 64rem at which the stylesheet lays out
 *  the complete physical book (closed cover, greeting, spreads); between 48rem and 64rem
 *  only a partial spread was styled, so tablets and phones in landscape opened onto a
 *  broken page. It is expressed in rem so the JS check cannot drift away from the CSS
 *  media query when the reader has changed their browser font size. In a media query
 *  rem resolves against the initial font size, exactly as the stylesheet's does. */
public static readonly spreadBreakpointRem=64;
public static readonly spreadBreakpointPx=1024;
public static readonly spreadMediaQuery=`(min-width: ${ReaderLayoutPolicy.spreadBreakpointRem}rem)`;
/** True when the viewport is wide enough for two pages side by side. Falls back to
 *  the pixel form where matchMedia is unavailable. */
public spreadFits(view:{matchMedia?:(query:string)=>{matches:boolean};innerWidth:number}):boolean{
  return view.matchMedia?view.matchMedia(ReaderLayoutPolicy.spreadMediaQuery).matches:this.doubleSupported(view.innerWidth);
}
public pageLayout(width:number,preference:"single"|"double",mobileDefault=true):"single"|"double"{if(width<768)return"single";if(width<1024&&mobileDefault)return"single";return preference==="double"?"double":"single";}public doubleSupported(width:number):boolean{return width>=ReaderLayoutPolicy.spreadBreakpointPx;}public rtlSpread(page:number):[number,number]{return[page+1,page];}}
