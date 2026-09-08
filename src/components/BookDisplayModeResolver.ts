import type { BookFocusState } from "./BookSelectionController";

export type BookDisplayMode = "FRONT" | "ANGLED_SOFT" | "ANGLED_REFERENCE";

export interface BookViewportInfo {
  width: number;
  kind: "mobile" | "tablet" | "desktop";
}

export interface BookDisplayModeInput {
  renderedShelfBookCount: number;
  viewport?: BookViewportInfo;
  focusState?: BookFocusState;
}

export class BookDisplayModeResolver {
  public resolve(input: BookDisplayModeInput): BookDisplayMode {
    const count = Math.max(0, Math.floor(input.renderedShelfBookCount));
    if (count <= 2) return "ANGLED_SOFT";
    return "ANGLED_REFERENCE";
  }

  public allowsSpine(input: BookDisplayModeInput): boolean { return this.resolve(input) !== "FRONT"; }
}
