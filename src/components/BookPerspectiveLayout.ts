import { BookDisplayModeResolver } from "./BookDisplayModeResolver";
export type BookVisualMode="FRONT"|"ANGLED_SOFT"|"ANGLED_REFERENCE"|"ANGLED"|"FOCUSED_ANGLED";
export interface BookPerspectiveProfile{mode:BookVisualMode;frontal:boolean;angle:number;selectedAngle:number;overlap:number;gap:number;}
export class BookPerspectiveLayout {
  /** One vanishing point per shelf: the camera lives on .book-shelf__viewport, never on each book. */
  public static readonly cameraOwner = "SHELF_VIEWPORT" as const;
  public static readonly referenceHeightRatio = .654;
  public static readonly rotateX = 0;
  /** Final value: 78deg keeps the spine dominant, with the cover reduced to the small
   *  slice the reference shows. Opening it (62/70deg) exposes 45-55% cover, which
   *  contradicts the reference and recreates the "it turned" reading even though
   *  rotateY is provably constant. Never REOPEN it (lower); 81deg only closes it further, making the
   *  diagonal subtler as asked, with an even smaller cover slice. */
  public static readonly rotateY = 81;
  public static readonly rotateZ = 0;
  public static forCount(count:number):BookPerspectiveProfile{const mode=new BookDisplayModeResolver().resolve({renderedShelfBookCount:count});if(mode==="FRONT")return{mode,frontal:true,angle:0,selectedAngle:0,overlap:0,gap:2};return{mode,frontal:false,angle:this.rotateY,selectedAngle:this.rotateY,overlap:-.58,gap:2};}
  public static responsiveWidth(viewport:number):number{return viewport<768?60:viewport<1024?82:100;}
}
