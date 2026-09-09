import type{PageTransform}from"./PageGeometry";
/** Only light a real leaf would produce: the shadow it throws on the page
 *  underneath, and the shading across its own back as it comes round. The old fold
 *  gradient parked on the right edge of the sheet is gone - it was painted at rest
 *  too, and read as a permanent smudge in the corner.
 *
 *  The verso is driven from here rather than from a mirrored pseudo-element,
 *  because the sheet needs `overflow:hidden` to keep its type inside the page and
 *  that would force `transform-style` back to flat. Swapping faces at exactly 90deg
 *  is seamless: the leaf is edge-on there, so it has no width to show a seam. */
export class PageShadowRenderer {
  public static readonly castsOnPageBelow=true;
  public static readonly hasRightEdgeFoldGradient=false;
  public static readonly versoTakesOverAtDegrees=90;
  /** The leaf casts a narrow shadow beside the gutter, not a wash across the text. */
  public static readonly maxCastShadow=.3;
  public render(page:HTMLElement,under:HTMLElement|null,geometry:PageTransform):void{
    const p=geometry.progress,lift=Math.sin(p*Math.PI);
    page.style.setProperty("--verso-opacity",Math.abs(geometry.angle)>PageShadowRenderer.versoTakesOverAtDegrees?"1":"0");
    page.style.setProperty("--verso-shade",String(.3-.24*p));
    page.style.setProperty("--leaf-lift",String(lift));
    under?.style.setProperty("--under-shadow",String(Math.min(PageShadowRenderer.maxCastShadow,lift*PageShadowRenderer.maxCastShadow)));
  }
  public clear(page:HTMLElement,under:HTMLElement|null):void{
    ["--verso-opacity","--verso-shade","--leaf-lift"].forEach(key=>page.style.removeProperty(key));
    under?.style.removeProperty("--under-shadow");
  }
}
