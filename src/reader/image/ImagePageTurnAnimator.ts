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
    const leaf = document.createElement("div");
    leaf.className = `reader-image-turn-leaf reader-image-turn-leaf--${direction}`;
    Object.assign(leaf.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
    leaf.append(this.face(image, "front"), this.face(image, "back"));
    document.body.append(leaf);
    const remove = (): void => leaf.remove();
    leaf.addEventListener("animationend", remove, { once: true });
    window.setTimeout(remove, 900);
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
