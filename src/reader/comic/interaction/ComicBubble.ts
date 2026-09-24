import type { ComicBubbleModel } from "./ComicInteractionTypes";

export interface ComicBubbleRenderContext {
  pageIndex: number;
  viewportBounds: DOMRectReadOnly;
}

export interface ComicBubble {
  readonly model: ComicBubbleModel;
  mount(target: HTMLElement, context: ComicBubbleRenderContext): void;
  update(model: ComicBubbleModel, context: ComicBubbleRenderContext): void;
  unmount(): void;
}
