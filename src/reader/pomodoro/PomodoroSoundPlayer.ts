/**
 * The two Pomodoro Lumeo sound cues. Android uses the bundled native completion
 * resource because WebView may reject timer-triggered HTMLAudio; the web reader
 * uses the public sound asset. Playback failure never interrupts reading.
 *
 * Separate from any future reading-music player (§13): that will be a persistent, downloaded,
 * user-chosen track played *during* reading; this is two short one-shot cues played *between*
 * reading and a break. Different lifecycles, so no code is shared, but nothing here assumes a
 * single global "the audio" either - each call makes its own Audio element - so a later music
 * player can coexist without fighting this one for the same instance.
 */
export type PomodoroSoundEvent = "readingFinished" | "breakFinished";

export interface PomodoroSoundPaths { readingFinished: string; breakFinished: string; }

import { Capacitor, registerPlugin, type Plugin } from "@capacitor/core";

interface ReaderSoundPlugin extends Plugin {
  playReadingFinished(): Promise<void>;
}

const NativeReaderSound = registerPlugin<ReaderSoundPlugin>("ReaderSound");

/** Web/PWA sound asset paths. Android completion playback uses res/raw directly. */
export const POMODORO_SOUND_PATHS: PomodoroSoundPaths = {
  readingFinished: "/sounds/fim-da-leitura.mp3",
  breakFinished: "/sounds/pomodoro-break-finished.mp3",
};

export class PomodoroSoundPlayer {
  public constructor(private readonly paths: PomodoroSoundPaths = POMODORO_SOUND_PATHS, private readonly enabled: () => boolean = () => true) {}

  /** LEITURA TERMINOU → "Hora da pausa": the cue that reading time is up. */
  public playReadingFinished(): void { this.play(this.paths.readingFinished); }
  /** PAUSA TERMINOU → "Hora de voltar à leitura": the cue that the break is over. */
  public playBreakFinished(): void { this.play(this.paths.breakFinished); }

  private play(path: string): void {
    if (!this.enabled()) return;
    // Timers are not user gestures. Android WebView may reject HTMLAudio from
    // them, so use the native resource bundled in the APK for the completion cue.
    if (typeof window !== "undefined" && Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("ReaderSound")) {
      void NativeReaderSound.playReadingFinished().catch(() => this.playWeb(path));
      return;
    }
    this.playWeb(path);
  }

  private playWeb(path: string): void {
    if (typeof Audio === "undefined") return;
    try { const audio = new Audio(path); audio.volume = 0.7; void audio.play().catch(() => undefined); }
    catch { /* No audio file yet, or the platform refused it: the dialog alone is enough. */ }
  }
}
