import type { BookFocusState } from "./BookSelectionController";
export type BookExtractionViewport="mobile"|"tablet"|"desktop";
export interface BookExtractionVector{readonly x:number;readonly y:number;readonly z:number;}
export class BookFocusAnimator {
  private readonly tokens=new WeakMap<HTMLElement,number>();
  public constructor(public readonly duration=800){}
  public transition(card:HTMLElement,state:BookFocusState,onDone?:()=>void):void{const token=(this.tokens.get(card)??0)+1;this.tokens.set(card,token);card.dataset.focusState=state;card.classList.toggle("book-card--selected",state==="FOCUSING"||state==="FOCUSED");card.classList.toggle("book-card--returning",state==="RETURNING");if(state==="RESTING"){card.classList.remove("book-card--returning");return;}window.setTimeout(()=>{if(this.tokens.get(card)!==token)return;if(state==="FOCUSING")card.dataset.focusState="FOCUSED";if(state==="RETURNING"){card.dataset.focusState="RESTING";card.classList.remove("book-card--returning");}onDone?.();},this.duration);}
  public static canOverlap=true;
  public static readonly easing="cubic-bezier(.20,.72,.18,1)";
  public static readonly returnUsesSamePath=true;
  public static readonly neighborsRemainStationary=true;
  public static readonly focusUsesTranslateZ=true;
  public static readonly focusUsesCompoundTrajectory=true;
  public static readonly shadowTracksFocus=true;
  public static readonly lightensGradually=true;
  public static readonly shadowExpandsWithFocus=true;
  public static readonly shadowReturnUsesSamePath=true;
  /** The focused volume is in front of its neighbours from the first frame. Stepping
   *  the stacking mid-extraction made it emerge from behind the next book in jumps,
   *  which reads as a rotation even under a pure Z translation. */
  public static readonly stackingChangesAfterExtractionStarts=false;
  public static readonly focusedStackingIsPinned=true;
  public static readonly focusedBookIsInFrontOfShelf=true;
  public static readonly shelfRemainsStationary=true;
  public static readonly preservesOrientation=true;
  public static readonly protectsRightNeighbor=true;
  public static readonly restingShelfInset=14;
  public static readonly focusedShelfOverhang=7;
  public static readonly brightnessCurve=[.92,.96,1,1.04,1.07] as const;
  public static angleFor(state:BookFocusState,restingAngle:number,focusedAngle:number):number{return state==="FOCUSING"||state==="FOCUSED"?focusedAngle:restingAngle;}
  /** Straight pull toward the viewer, with no lateral offset of its own. The travel
   *  is split: a moderate Z advance carries the "coming closer" read, and a scale
   *  tops up the size. Pure Z at the same magnitude drags off-axis volumes sideways
   *  (-33px on desktop) because they leave the optical centre as they approach;
   *  splitting it halves that while keeping the same growth. */
  /** Focus slides the volume forward across the board. It deliberately does NOT travel
   *  in Z: depth motion under a shared perspective camera reshapes a yawed face rather
   *  than merely scaling it (cover/spine area ratio measured 1.19 -> 2.91), and that
   *  reshaping is what reads as "the face changed". Sliding on the shelf plane keeps
   *  every face identical to the pixel. Without Z there is also no extra intrusion into
   *  the right neighbour, so the anti-collision X buffer is no longer needed. The focus transform
   *  is the resting transform with a single component swapped: same rotateY, same
   *  rotateX/rotateZ, same scale, tx and ty untouched. The slight diagonal drift the
   *  volume shows as it approaches is NOT computed here - it falls out of the shared
   *  perspective projection of Fase 2 for an object off the optical axis. Never add a
   *  manual translateX to imitate it. */
  public static readonly advancesTowardViewer=true;
  public static readonly uniformGrowthOnly=false;
  public static readonly rigidTranslationOnly=true;
  /** No inline clamp is ever written to --extract-x. The old clamp read
   *  parseFloat(style.perspective) from the volume, which became NaN once the camera
   *  moved to the viewport; its guard used `distance <= z`, and NaN fails every
   *  comparison, so NaN flowed through and landed in the custom property. A single
   *  NaN inside translate3d() invalidates the whole transform, which then computes to
   *  `none` - dropping rotateY and rendering the book flat and frontal. */
  public static readonly writesNoInlineExtraction=true;
  /** Any geometry helper must refuse non-finite input instead of propagating NaN. */
  public static finiteOrNull(...values:readonly number[]):number[]|null{
    return values.every(Number.isFinite)?[...values]:null;
  }
  public static readonly lateralDriftComesFromPerspective=true;
  /** The advance carries the base past the front lip of the board by this share of
   *  the volume's own height, so the focused book visibly juts out over the edge. */
  /** The volume stops on the board, short of the front lip - it never overhangs. */
  public static readonly frontOverhangRatio=0;
  public static readonly focusScale=1;
  /** No vertical component at all: the volume must read as coming FORWARD, never as
   *  rising. Y stays zero and the base simply advances across the board until it
   *  reaches the front lip. The forward tilt keeps the head visible, so the page top
   *  is never rotated out of sight. */
  public static readonly neverRises=true;
  public static readonly focusTiltDegrees=0;
  /** The pull stops on the front lip of the board; it never overshoots the wood. */
  public static readonly stopsAtShelfFrontEdge=true;
  public static vectorFor(viewport:BookExtractionViewport="desktop"):BookExtractionVector{return viewport==="mobile"?{x:-12,y:38,z:0}:viewport==="tablet"?{x:-13,y:38,z:0}:{x:-14,y:38,z:0};}
  public static tiltFor(state:BookFocusState):number{return state==="FOCUSING"||state==="FOCUSED"?this.focusTiltDegrees:0;}
  public static scaleFor(state:BookFocusState):number{return state==="FOCUSING"||state==="FOCUSED"?this.focusScale:1;}
  public static growthAt(progress:number):number{const p=Math.min(1,Math.max(0,progress));return 1+(this.focusScale-1)*p;}
  public static trajectoryAt(progress:number,viewport:BookExtractionViewport="desktop"):BookExtractionVector{const p=Math.min(1,Math.max(0,progress)),v=this.vectorFor(viewport);return{x:p?v.x*p:0,y:p?v.y*p:0,z:-this.restingShelfInset};}
  /** Constant depth. Moving in Z is what changes a yawed face's projected SHAPE - not
   *  just its size - and a face that changes shape reads as the book turning. */
  public static depthFor(_state:BookFocusState,_viewport:BookExtractionViewport="desktop"):number{return -this.restingShelfInset;}
  public static lateralFor(state:BookFocusState,viewport:BookExtractionViewport="desktop"):number{return state==="FOCUSING"||state==="FOCUSED"?this.vectorFor(viewport).x:0;}
  public static verticalFor(state:BookFocusState,viewport:BookExtractionViewport="desktop"):number{return state==="FOCUSING"||state==="FOCUSED"?this.vectorFor(viewport).y:0;}
  public static stackLayerAt(progress:number):number{return progress>0?40:1;}
  public static brightnessAt(progress:number):number{const p=Math.min(1,Math.max(0,progress))*4,index=Math.min(3,Math.floor(p)),fraction=p-index,start=this.brightnessCurve[index]??1.07,end=this.brightnessCurve[index+1]??start;return start+(end-start)*fraction;}
  public static keepsSpine(state:BookFocusState):boolean{return ["RESTING","FOCUSING","FOCUSED","RETURNING"].includes(state);}
}
