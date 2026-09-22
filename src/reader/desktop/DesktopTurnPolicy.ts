import { Capacitor } from "@capacitor/core";
import { PageGestureIntent } from "../page-turn/PageGestureIntent";

export function usesDesktopMouseTurn(): boolean {
  return !Capacitor.isNativePlatform() && typeof matchMedia === "function"
    && matchMedia("(min-width: 64rem) and (pointer: fine)").matches;
}

/** Holding Shift retains native text selection; controls and existing selections stay interactive. */
export function startsDesktopTurn(event: Pick<PointerEvent, "button" | "target" | "pointerType" | "shiftKey" | "detail">): boolean {
  if (event.pointerType !== "mouse") return PageGestureIntent.startsTurn(event);
  if (event.button !== 0 || event.shiftKey || event.detail > 1) return false;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(PageGestureIntent.interactiveSelector)) return false;
  const selection = getSelection();
  return !selection || selection.isCollapsed || !selection.toString().trim();
}
