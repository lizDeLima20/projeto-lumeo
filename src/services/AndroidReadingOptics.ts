import { Capacitor, registerPlugin, type Plugin } from "@capacitor/core";

export interface ReadingOpticsProfile {
  sensorAvailable: boolean;
  luxBucket: 0 | 1 | 2 | 3 | 4;
  paperWeight: number;
  inkWeight: number;
  recommendedBrightness: number;
}

interface NativeReadingOptics extends Plugin {
  start(): Promise<ReadingOpticsProfile>;
  stop(): Promise<void>;
  getState(): Promise<{ active: boolean; sensorAvailable: boolean; lux: number | null }>;
  addListener(eventName: "profile", listenerFunc: (profile: ReadingOpticsProfile) => void): Promise<{ remove: () => Promise<void> }>;
}

const NativeOptics = registerPlugin<NativeReadingOptics>("ReadingOptics");

/** Android-only ambient-light bridge. It has no web fallback and never asks for permission. */
export class AndroidReadingOptics {
  private static removeListener: (() => Promise<void>) | null = null;

  public static get available(): boolean {
    return typeof window !== "undefined" && Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("ReadingOptics");
  }

  public static async start(onProfile: (profile: ReadingOpticsProfile) => void): Promise<void> {
    if (!this.available) return;
    await this.stop();
    try {
      const listener = await NativeOptics.addListener("profile", onProfile);
      this.removeListener = listener.remove;
      onProfile(await NativeOptics.start());
    } catch {
      // Hardware support is optional: ReaderView retains its stable paper defaults.
      onProfile({ sensorAvailable: false, luxBucket: 2, paperWeight: 100, inkWeight: 100, recommendedBrightness: 60 });
    }
  }

  public static async stop(): Promise<void> {
    const remove = this.removeListener; this.removeListener = null;
    try { await remove?.(); } catch { /* listener may already belong to a destroyed WebView */ }
    if (!this.available) return;
    try { await NativeOptics.stop(); } catch { /* no sensor never blocks closing a book */ }
  }
}
