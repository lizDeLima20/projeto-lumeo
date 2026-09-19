/**
 * The two Pomodoro Lumeo sound cues. This is deliberately just the architecture: the two
 * files themselves are not included yet (the user will supply them), so both paths point at
 * files that do not exist on disk today. Playback failure - file missing, autoplay blocked,
 * `Audio` unavailable outside a browser - is always swallowed silently: a missing sound must
 * never interrupt reading or throw, only the on-screen dialog is required.
 *
 * Separate from any future reading-music player (§13): that will be a persistent, downloaded,
 * user-chosen track played *during* reading; this is two short one-shot cues played *between*
 * reading and a break. Different lifecycles, so no code is shared, but nothing here assumes a
 * single global "the audio" either - each call makes its own Audio element - so a later music
 * player can coexist without fighting this one for the same instance.
 */
export type PomodoroSoundEvent = "readingFinished" | "breakFinished";

export interface PomodoroSoundPaths { readingFinished: string; breakFinished: string; }

/** Where the two cue files are expected once supplied - drop them in unchanged and this
 *  starts playing them, no code change required. */
export const POMODORO_SOUND_PATHS: PomodoroSoundPaths = {
  readingFinished: "/sounds/pomodoro-reading-finished.mp3",
  breakFinished: "/sounds/pomodoro-break-finished.mp3",
};

export class PomodoroSoundPlayer {
  public constructor(private readonly paths: PomodoroSoundPaths = POMODORO_SOUND_PATHS, private readonly enabled: () => boolean = () => true) {}

  /** LEITURA TERMINOU → "Hora da pausa": the cue that reading time is up. */
  public playReadingFinished(): void { this.play(this.paths.readingFinished); }
  /** PAUSA TERMINOU → "Hora de voltar à leitura": the cue that the break is over. */
  public playBreakFinished(): void { this.play(this.paths.breakFinished); }

  private play(path: string): void {
    if (!this.enabled() || typeof Audio === "undefined") return;
    try { const audio = new Audio(path); audio.volume = 0.7; void audio.play().catch(() => undefined); }
    catch { /* No audio file yet, or the platform refused it: the dialog alone is enough. */ }
  }
}
