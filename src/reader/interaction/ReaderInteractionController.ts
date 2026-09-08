export type ReaderGestureIntent = "TAP" | "LONG_PRESS" | "TEXT_SELECTION" | "SWIPE" | "SETTINGS_CLICK" | "IMAGE_PAN" | "PINCH_ZOOM" | "NONE";
export interface ReaderPointerSample { x: number; y: number; time: number; target: "content" | "settings" | "control"; hasSelection?: boolean; }

export class ReaderInteractionController {
  private startSample: ReaderPointerSample | null = null;
  private suppressNextClick = false;
  public constructor(private readonly swipeThreshold = 55, private readonly longPressMs = 420, private readonly driftThreshold = 12) {}
  public begin(sample: ReaderPointerSample): void { this.startSample = sample; }
  public end(sample: ReaderPointerSample & { pointerCount?: number; zoomed?: boolean }): ReaderGestureIntent {
    if (sample.target === "settings") return "SETTINGS_CLICK";
    if ((sample.pointerCount??1) > 1) return "PINCH_ZOOM";
    const start = this.startSample ?? sample, dx = sample.x - start.x, dy = sample.y - start.y, elapsed = sample.time - start.time;
    if (sample.zoomed && Math.hypot(dx, dy) > this.driftThreshold) return "IMAGE_PAN";
    if (Math.abs(dx) >= this.swipeThreshold && Math.abs(dx) > Math.abs(dy) * 1.25) { this.suppressNextClick = true; return "SWIPE"; }
    if (sample.hasSelection) return "TEXT_SELECTION";
    if (elapsed >= this.longPressMs && Math.hypot(dx, dy) <= this.driftThreshold) return "LONG_PRESS";
    return "TAP";
  }
  public opensSettings(intent: ReaderGestureIntent): boolean { return intent === "SETTINGS_CLICK"; }
  public consumeSuppressedClick(): boolean { const value = this.suppressNextClick; this.suppressNextClick = false; return value; }
}
