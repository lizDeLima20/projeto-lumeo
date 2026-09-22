import { usesDesktopMouseTurn } from "../desktop/DesktopTurnPolicy";
import { FlexiblePageCurl } from "../page-turn/FlexiblePageCurl";
import { PageGeometry } from "../page-turn/PageGeometry";
import { PageTurnEngine, type TurnDirection } from "../page-turn/PageTurnEngine";

export type ImageTurnDirection = "next" | "previous";

/** Keeps scanned PDFs in the same visual page-turn flow as reflow books. */
export class ImagePageTurnAnimator {
  public static readonly usesOpaqueFrontAndBackFaces = true;
  public static readonly keepsDestinationPageUnderLeaf = true;

  public capture(source: HTMLCanvasElement): string | null {
    if (!source.width || !source.height) return null;
    try { return source.toDataURL("image/png"); }
    catch { return null; }
  }

  public play(source: HTMLCanvasElement, direction: ImageTurnDirection, image: string | null): void {
    if (!image) return;
    const bounds = source.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    /* A scanned/image PDF used to bypass the Web page-curl completely and always run
       the legacy rigid CSS flip. That made production look unchanged even though the
       reflow spread had the new engine. Keep Android untouched, but on desktop Web use
       the same continuous opaque mesh as text pages. */
    if (usesDesktopMouseTurn()) { void this.playDesktop(source, direction, image, bounds); return; }
    /* `source` has already rendered the destination page when this method runs.  A
     * physical leaf therefore carries the page we were seeing on its front and the
     * already prepared destination on its back.  Reusing the front bitmap for both
     * sides made the sheet look like transparent glass while it crossed 90 degrees. */
    const verso = this.capture(source) ?? image;
    const leaf = document.createElement("div");
    leaf.className = `reader-image-turn-leaf reader-image-turn-leaf--${direction}`;
    Object.assign(leaf.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
    leaf.append(this.face(image, "front"), this.face(verso, "back"));
    document.body.append(leaf);
    const remove = (): void => leaf.remove();
    leaf.addEventListener("animationend", remove, { once: true });
    window.setTimeout(remove, 900);
  }

  private async playDesktop(source: HTMLCanvasElement, direction: ImageTurnDirection,
    frontSource: string, bounds: DOMRect): Promise<void> {
    const backSource = this.capture(source) ?? frontSource;
    const leaf = document.createElement("div");
    leaf.className = "reader-image-turn-leaf reader-image-turn-leaf--flexible";
    Object.assign(leaf.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
    const front = this.face(frontSource, "front");
    const verso = document.createElement("div"); verso.className = "page-turn-verso";
    const back = this.face(backSource, "back");
    // FlexiblePageCurl performs the physical mirroring; the capture itself must be a
    // normal, readable page rather than the CSS-flipped legacy back face.
    back.style.transform = "none"; back.style.filter = "none";
    verso.append(back); leaf.append(front, verso); document.body.append(leaf);
    try {
      await Promise.all([this.ready(front), this.ready(back)]);
      const curl = new FlexiblePageCurl(true);
      await curl.prepareReady(leaf);
      const turn: TurnDirection = direction === "next" ? 1 : -1;
      const engine = new PageTurnEngine(leaf, null, () => undefined, new PageGeometry(),
        undefined, undefined, undefined, curl);
      await engine.programmatic(turn);
    } finally { leaf.remove(); }
  }

  private ready(image: HTMLImageElement): Promise<void> {
    if (image.complete) return Promise.resolve();
    return image.decode().catch(() => undefined);
  }

  private face(source: string, side: "front" | "back"): HTMLImageElement {
    const image = document.createElement("img");
    image.className = `reader-image-turn-leaf__${side}`;
    image.src = source;
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    return image;
  }
}
