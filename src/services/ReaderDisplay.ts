import { Capacitor, registerPlugin, type Plugin } from "@capacitor/core";

interface ReaderDisplayPlugin extends Plugin {
  setReaderBrightness(options: { value: number }): Promise<{ readerBrightness: number | null }>;
  restoreSystemBrightness(): Promise<{ readerBrightness: null }>;
}

const NativeReaderDisplay = registerPlugin<ReaderDisplayPlugin>("ReaderDisplay");

/**
 * Reading brightness of the Lumeo window on Android. Everywhere else it does nothing:
 * the web reader keeps its own paper tone. The phone's own brightness setting is never
 * changed; leaving the Reader hands the screen back to the system level.
 */
export class ReaderDisplay {
  /** Slider range, in percent of the screen's full brightness. */
  public static readonly minPercent = 2;
  public static readonly maxPercent = 100;

  public static get available(): boolean {
    if (typeof window === "undefined") return false;
    return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("ReaderDisplay");
  }

  /** null follows the system brightness; a number is the Reader's own level. */
  public static async apply(percent: number | null): Promise<void> {
    if (!ReaderDisplay.available) return;
    try {
      if (percent === null) await NativeReaderDisplay.restoreSystemBrightness();
      else await NativeReaderDisplay.setReaderBrightness({ value: ReaderDisplay.level(percent) });
    } catch { /* The page stays readable at the system level. */ }
  }

  public static async restore(): Promise<void> {
    if (!ReaderDisplay.available) return;
    try { await NativeReaderDisplay.restoreSystemBrightness(); } catch { /* nothing to restore */ }
  }

  /** Percent of the slider to the window level Android expects (0..1). */
  public static level(percent: number): number {
    const clamped = Math.min(ReaderDisplay.maxPercent, Math.max(ReaderDisplay.minPercent, percent));
    return Math.round(clamped) / 100;
  }
}
