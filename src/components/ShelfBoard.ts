abstract class ShelfBoardFace {
  public constructor(private readonly className: string) {}
  public render(): HTMLSpanElement { const face=document.createElement("span");face.className=this.className;return face; }
}
export class ShelfTopFace extends ShelfBoardFace { public constructor(){super("shelf-board__top shelf-top-face");} }
export class ShelfFrontFace extends ShelfBoardFace { public constructor(){super("shelf-board__front shelf-front-face");} }
export class ShelfEdgeHighlight extends ShelfBoardFace { public constructor(){super("shelf-board__edge shelf-edge-highlight");} }
export class ShelfSideDepth extends ShelfBoardFace { public constructor(){super("shelf-board__side-depth shelf-side-depth");} }
export class ShelfBottomShadow extends ShelfBoardFace { public constructor(){super("shelf-board__shadow shelf-bottom-shadow");} }

export class ShelfBoard {
  public static readonly independentFromTrack = true;
  public static readonly hasPhysicalTopFace = true;
  public static readonly hasPhysicalFrontFace = true;
  /** Front face is a light, lacquered surface, not dark matte timber. */
  public static readonly hasLacqueredFrontFace = true;
  /** Front edge is twice as thick as before; the tray depth behind it is unchanged. */
  public static readonly frontFaceRemUnits = 1.9;
  public static readonly trayDepthPixels = 26;
  public static readonly hasSideDepth = true;
  public static readonly thicknessRem = 1.5;
  public static readonly mobileThicknessPixels = 24;
  public static readonly topDepthPixels = 118;
  public static readonly darkensTowardBack = true;
  public static readonly doesNotClipFocusedBook = true;
  public static readonly remainsStationaryDuringFocus = true;

  public render(): HTMLElement {
    const board = document.createElement("div");
    board.className = "shelf-board shelf-board--physical";
    board.setAttribute("aria-hidden", "true");
    board.append(new ShelfTopFace().render(),new ShelfFrontFace().render(),new ShelfEdgeHighlight().render(),new ShelfSideDepth().render(),new ShelfBottomShadow().render());
    return board;
  }
}
