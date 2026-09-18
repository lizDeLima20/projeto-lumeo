export type PomodoroPhase = "focus" | "break" | "break-over" | "paused";

/**
 * The Pomodoro Lumeo clock, without timers or DOM: the view feeds it elapsed seconds and
 * shows what it answers. Focus time runs only while the reader is reading.
 */
export class PomodoroCycle {
  private phaseValue: PomodoroPhase = "focus";
  private elapsed = 0;

  public constructor(private focusSeconds: number, private breakSeconds: number) {}

  public get phase(): PomodoroPhase { return this.phaseValue; }
  /** Seconds left in the current focus or break period. */
  public get remaining(): number {
    if (this.phaseValue === "break") return Math.max(0, this.breakSeconds - this.elapsed);
    if (this.phaseValue === "focus") return Math.max(0, this.focusSeconds - this.elapsed);
    return 0;
  }

  public configure(focusMinutes: number, breakMinutes: number): void {
    this.focusSeconds = Math.max(1, Math.round(focusMinutes)) * 60;
    this.breakSeconds = Math.max(1, Math.round(breakMinutes)) * 60;
  }

  /** Advances the clock. Returns the seconds that count as reading and whether the phase changed. */
  public tick(seconds: number): { readingSeconds: number; changed: boolean } {
    if (seconds <= 0 || this.phaseValue === "paused" || this.phaseValue === "break-over") return { readingSeconds: 0, changed: false };
    if (this.phaseValue === "focus") {
      const reading = Math.min(seconds, this.focusSeconds - this.elapsed);
      this.elapsed += reading;
      if (this.elapsed >= this.focusSeconds) { this.phaseValue = "break"; this.elapsed = 0; return { readingSeconds: reading, changed: true }; }
      return { readingSeconds: reading, changed: false };
    }
    this.elapsed += seconds;
    if (this.elapsed >= this.breakSeconds) { this.phaseValue = "break-over"; this.elapsed = 0; return { readingSeconds: 0, changed: true }; }
    return { readingSeconds: 0, changed: false };
  }

  /** A pause the reader asked for; the focus period keeps what it had counted. */
  public pause(): boolean { if (this.phaseValue !== "focus") return false; this.phaseValue = "paused"; return true; }
  /** Back to reading, after a manual pause or a finished (or skipped) break. */
  public resume(): boolean {
    if (this.phaseValue === "focus") return false;
    if (this.phaseValue !== "paused") this.elapsed = 0;
    this.phaseValue = "focus"; return true;
  }
}
