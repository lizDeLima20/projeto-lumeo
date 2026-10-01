import { Capacitor, registerPlugin, type Plugin } from "@capacitor/core";

interface ReaderImmersivePlugin extends Plugin {
  enter(): Promise<{ immersive: boolean }>;
  exit(): Promise<{ immersive: boolean }>;
}

const NativeReaderImmersive = registerPlugin<ReaderImmersivePlugin>("ReaderImmersive");

/**
 * Full-screen reading for the Comic Reader on Android: hides the status and navigation
 * bars and lets the page draw edge-to-edge for as long as a comic is open, reclaiming the
 * strip of screen those bars would otherwise reserve. A swipe from either edge still
 * reveals them for a moment - this never removes the device's own navigation, only keeps
 * it out of the way by default. Everywhere else - every other screen, iOS, the web - this
 * does nothing.
 */
export class ReaderImmersive {
  public static get available(): boolean {
    if (typeof window === "undefined") return false;
    return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("ReaderImmersive");
  }

  public static async enter(): Promise<void> {
    if (!ReaderImmersive.available) return;
    try { await NativeReaderImmersive.enter(); } catch { /* the page stays at its normal size */ }
  }

  public static async exit(): Promise<void> {
    if (!ReaderImmersive.available) return;
    try { await NativeReaderImmersive.exit(); } catch { /* nothing to restore */ }
  }
}
