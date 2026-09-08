import { BookSelectionController, type BookActivation } from "./BookSelectionController";

export type BookHitResult = BookActivation | "ignored";

export class BookInteractionRegion {
  public static readonly visibleFaceSelector = [
    ".physical-face",
    ".book-front-face",
    ".book-spine",
    ".book-top-cover-face",
    ".page-block-3d",
    ".book-right-depth-face",
  ].join(",");
  public static readonly structuralSlotCapturesPointer = false;
  public static readonly secondClickRequiresVisibleFace = true;

  public ownsVisibleTarget(target: EventTarget | null, root: HTMLElement): boolean {
    if (!(target instanceof Element)) return false;
    const face = target.closest(BookInteractionRegion.visibleFaceSelector);
    return face !== null && root.contains(face);
  }

  public activate(
    selection: BookSelectionController,
    bookId: string,
    target: EventTarget | null,
    root: HTMLElement,
  ): BookHitResult {
    return this.ownsVisibleTarget(target, root) ? selection.activate(bookId) : "ignored";
  }

  public static activationFor(
    selection: BookSelectionController,
    bookId: string,
    visibleFaceHit: boolean,
  ): BookHitResult {
    return visibleFaceHit ? selection.activate(bookId) : "ignored";
  }
}
