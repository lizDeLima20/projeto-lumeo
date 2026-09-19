import { I18nManager, type TranslationKey } from "../i18n/I18nManager";
import { PomodoroCycle } from "../reader/pomodoro/PomodoroCycle";
import { PomodoroSoundPlayer } from "../reader/pomodoro/PomodoroSoundPlayer";
import type { ReadingDay, ReadingDayTracker } from "../reader/pomodoro/ReadingDayTracker";
import type { ReaderPreferences } from "../reader/settings/ReaderPreferences";

/**
 * Pomodoro Lumeo on the reading screen: a small, collapsed indicator - never a permanently
 * shown "25:00" - that expands on tap and collapses on the next tap. Exactly one goal drives
 * a session: Tempo runs the focus/break clock; Páginas only counts pages read, with no
 * ticking countdown at all. Reading time counts only while the page is visible and (in
 * Tempo mode) the reader is in a focus period.
 */
export class ReaderPomodoroView {
  private readonly i18n = I18nManager.shared;
  private readonly cycle: PomodoroCycle;
  private readonly sound: PomodoroSoundPlayer;
  private chip: HTMLDivElement | null = null;
  private expandButton: HTMLButtonElement | null = null;
  private chipTime: HTMLElement | null = null;
  private pauseButton: HTMLButtonElement | null = null;
  private dialog: HTMLElement | null = null;
  private timer = 0;
  private lastTick = 0;
  private dayCache: Readonly<ReadingDay> | null = null;
  private expanded = false;

  public constructor(
    private readonly tracker: ReadingDayTracker,
    private readonly preferences: () => Readonly<ReaderPreferences>,
    private readonly onReturnTomorrow: () => void,
    sound: PomodoroSoundPlayer = new PomodoroSoundPlayer(),
  ) {
    const value = preferences();
    this.cycle = new PomodoroCycle(value.pomodoroFocusMinutes * 60, value.pomodoroBreakMinutes * 60);
    this.sound = sound;
  }

  public mount(parent: HTMLElement): void {
    const chip = document.createElement("div");
    chip.className = "reader-pomodoro-chip"; chip.hidden = true;
    const expand = document.createElement("button");
    expand.type = "button"; expand.className = "reader-pomodoro-chip__expand"; expand.setAttribute("aria-expanded", "false");
    const dot = document.createElement("span"); dot.className = "reader-pomodoro-chip__icon"; dot.setAttribute("aria-hidden", "true"); dot.textContent = "🍅";
    this.chipTime = document.createElement("span"); this.chipTime.className = "reader-pomodoro-chip__time";
    this.pauseButton = document.createElement("button"); this.pauseButton.type = "button"; this.pauseButton.className = "reader-pomodoro-chip__pause";
    this.pauseButton.addEventListener("click", (event) => { event.stopPropagation(); void this.togglePause(); });
    expand.append(dot, this.chipTime); chip.append(expand, this.pauseButton);
    expand.addEventListener("click", () => this.toggleExpanded());
    this.chip = chip; this.expandButton = expand; parent.append(chip);
    document.addEventListener("visibilitychange", this.visibility);
    this.sync();
  }

  /** Re-reads the preferences: turning the option on/off, switching Tempo/Páginas, new durations. */
  public sync(): void {
    const value = this.preferences();
    this.cycle.configure(value.pomodoroFocusMinutes, value.pomodoroBreakMinutes);
    if (!this.chip) return;
    this.chip.hidden = !value.pomodoroEnabled;
    if (value.pomodoroEnabled && value.pomodoroGoalType === "time") this.start(); else { this.stop(); this.closeDialog(); }
    this.render();
  }

  public get enabled(): boolean { return this.preferences().pomodoroEnabled; }
  private get isTimeGoal(): boolean { return this.preferences().pomodoroGoalType === "time"; }

  /** Called after a turn forward with the page numbers now in view. */
  public async pagesViewed(bookId: string, pages: readonly number[]): Promise<void> {
    if (!this.enabled) return;
    const result = await this.tracker.pagesViewed(bookId, pages, this.preferences().dailyPagesGoal);
    this.dayCache = result.day;
    this.render();
    if (result.goalReached) this.showGoal(result.day);
  }

  public destroy(): void {
    this.stop(); this.closeDialog();
    document.removeEventListener("visibilitychange", this.visibility);
    this.chip?.remove(); this.chip = null; this.expandButton = null;
  }

  private toggleExpanded(): void {
    this.expanded = !this.expanded;
    this.chip?.classList.toggle("reader-pomodoro-chip--expanded", this.expanded);
    this.expandButton?.setAttribute("aria-expanded", String(this.expanded));
    this.render();
  }

  private start(): void {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.timer = window.setInterval(() => void this.tick(), 1000);
  }
  private stop(): void { window.clearInterval(this.timer); this.timer = 0; }

  private async tick(): Promise<void> {
    const now = Date.now(), seconds = (now - this.lastTick) / 1000; this.lastTick = now;
    // A hidden app is not reading: the time the screen was off or the app in background never counts.
    if (document.visibilityState !== "visible" || seconds > 5) { this.render(); return; }
    const before = this.cycle.phase, step = this.cycle.tick(seconds);
    if (step.readingSeconds > 0) this.dayCache = await this.tracker.addReadingSeconds(step.readingSeconds);
    if (step.changed && before === "focus" && this.cycle.phase === "break") { this.dayCache = await this.tracker.pause(); this.sound.playReadingFinished(); this.showBreak(); }
    else if (step.changed && this.cycle.phase === "break-over") { this.sound.playBreakFinished(); this.showBreakOver(); }
    else if (this.cycle.phase === "break") this.updateBreakCountdown();
    this.render();
  }

  private readonly visibility = (): void => { this.lastTick = Date.now(); };

  private async togglePause(): Promise<void> {
    if (!this.isTimeGoal) return;
    if (this.cycle.phase === "focus" && this.cycle.pause()) { this.dayCache = await this.tracker.pause(); this.showPaused(); }
    else if (this.cycle.phase === "paused") await this.resume();
    this.render();
  }

  private async resume(): Promise<void> {
    if (this.cycle.resume()) this.dayCache = await this.tracker.resume();
    this.lastTick = Date.now(); this.closeDialog(); this.render();
  }

  /** Collapsed: just the tomato, no numbers - never a permanent, attention-grabbing clock.
   *  Expanded: the state in words, plus a pause control only when there is a clock to pause. */
  private render(): void {
    if (!this.chip || !this.expandButton || !this.chipTime || !this.pauseButton) return;
    const timeGoal = this.isTimeGoal, phase = this.cycle.phase;
    this.chip.classList.toggle("reader-pomodoro-chip--paused", timeGoal && phase !== "focus");
    if (!this.expanded) {
      this.chipTime.textContent = ""; this.pauseButton.hidden = true;
      this.expandButton.setAttribute("aria-label", this.t("reader.pomodoro.expand"));
      return;
    }
    this.expandButton.setAttribute("aria-label", this.t("reader.pomodoro.collapse"));
    if (timeGoal) {
      const time = ReaderPomodoroView.clock(this.cycle.remaining);
      this.chipTime.textContent = phase === "focus" ? time : phase === "break" ? this.t("reader.pomodoro.chipBreak", { time }) : this.t("reader.pomodoro.chipPaused");
      this.pauseButton.hidden = phase === "break" || phase === "break-over";
      this.pauseButton.textContent = phase === "paused" ? "▶" : "⏸";
      this.pauseButton.setAttribute("aria-label", phase === "paused" ? this.t("reader.pomodoro.resumeAction") : this.t("reader.pomodoro.pauseAction"));
    } else {
      const day = this.dayCache, goal = this.preferences().dailyPagesGoal;
      this.chipTime.textContent = this.t("reader.pomodoro.pagesProgress", { count: day?.pagesRead ?? 0, goal });
      this.pauseButton.hidden = true;
    }
  }

  private showPaused(): void {
    this.openDialog(this.t("reader.pomodoro.paused.title"), [this.t("reader.pomodoro.paused.body"), this.todayLine()],
      [[this.t("reader.pomodoro.resumeAction"), () => void this.resume(), true]]);
  }

  private showBreak(): void {
    const value = this.preferences();
    this.openDialog(this.t("reader.pomodoro.break.title"),
      [this.t("reader.pomodoro.break.body", { minutes: value.pomodoroFocusMinutes, time: ReaderPomodoroView.clock(this.cycle.remaining) }), this.todayLine()],
      [[this.t("reader.pomodoro.break.skip"), () => void this.resume(), false]], "reader-pomodoro-dialog--break");
  }

  private updateBreakCountdown(): void {
    const body = this.dialog?.querySelector<HTMLElement>(".reader-pomodoro-dialog__body");
    if (body && this.dialog?.classList.contains("reader-pomodoro-dialog--break"))
      body.textContent = this.t("reader.pomodoro.break.body", { minutes: this.preferences().pomodoroFocusMinutes, time: ReaderPomodoroView.clock(this.cycle.remaining) });
  }

  private showBreakOver(): void {
    this.openDialog(this.t("reader.pomodoro.breakOver.title"), [this.t("reader.pomodoro.breakOver.body"), this.todayLine()],
      [[this.t("reader.pomodoro.resumeAction"), () => void this.resume(), true]]);
  }

  private showGoal(day: Readonly<ReadingDay>): void {
    const time = day.firstReadAt ?? ReaderPomodoroView.now();
    this.openDialog(this.t("reader.pomodoro.goal.title"),
      [this.t("reader.pomodoro.goal.body", { pages: day.pagesRead, minutes: Math.floor(day.readingSeconds / 60) }), this.t("reader.pomodoro.goal.question")],
      [[this.t("reader.pomodoro.goal.continue"), () => { void this.tracker.decideGoal("continue"); this.closeDialog(); }, true],
       [this.t("reader.pomodoro.goal.tomorrow", { time }), () => void this.returnTomorrowChoice(time), false]], "reader-pomodoro-dialog--goal");
  }

  private async returnTomorrowChoice(time: string): Promise<void> {
    await this.tracker.decideGoal("tomorrow");
    const body = this.dialog?.querySelector<HTMLElement>(".reader-pomodoro-dialog__body");
    this.dialog?.querySelector(".reader-pomodoro-dialog__actions")?.remove();
    if (body) body.textContent = this.t("reader.pomodoro.goal.seeYou", { time });
    window.setTimeout(() => { this.closeDialog(); this.onReturnTomorrow(); }, 1600);
  }

  private openDialog(title: string, lines: string[], actions: Array<[string, () => void, boolean]>, modifier = ""): void {
    this.closeDialog();
    const dialog = document.createElement("div");
    dialog.className = `reader-pomodoro-dialog ${modifier}`.trim(); dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true");
    const panel = document.createElement("section"); panel.className = "reader-pomodoro-dialog__panel";
    const heading = document.createElement("h2"); heading.id = "reader-pomodoro-title"; heading.textContent = `🍅 ${title}`;
    dialog.setAttribute("aria-labelledby", heading.id);
    panel.append(heading);
    lines.filter(Boolean).forEach((text, index) => { const line = document.createElement("p"); line.className = index === 0 ? "reader-pomodoro-dialog__body" : "reader-pomodoro-dialog__today"; line.textContent = text; panel.append(line); });
    const row = document.createElement("div"); row.className = "reader-pomodoro-dialog__actions";
    actions.forEach(([label, action, primary]) => { const button = document.createElement("button"); button.type = "button"; button.className = `button ${primary ? "button--primary" : "button--secondary"}`; button.textContent = label; button.addEventListener("click", action); row.append(button); });
    panel.append(row); dialog.append(panel);
    // Taps on the page behind must not turn it while the dialog is open.
    dialog.addEventListener("pointerdown", (event) => event.stopPropagation());
    (this.chip?.parentElement ?? document.body).append(dialog); this.dialog = dialog;
    row.querySelector<HTMLButtonElement>("button")?.focus();
  }

  private closeDialog(): void { this.dialog?.remove(); this.dialog = null; }

  private todayLine(): string {
    const day = this.dayCache; if (!day) return "";
    return `${this.t("reader.pomodoro.today")}: ${[
      this.t("reader.pomodoro.minutes", { count: Math.floor(day.readingSeconds / 60) }),
      this.count("reader.pomodoro.pages", day.pagesRead), this.count("reader.pomodoro.pauses", day.pauses), this.count("reader.pomodoro.resumes", day.resumes),
    ].join(" · ")}`;
  }

  /** "one|other": exactly one takes the first form. Intl's Portuguese rule treats 0 as "one". */
  private count(key: TranslationKey, count: number): string { const [one = "", other] = this.t(key, { count }).split("|"); return count === 1 ? one : other ?? one; }
  private t(key: TranslationKey, parameters?: Record<string, string | number>): string { return this.i18n.t(key, parameters); }
  public static clock(seconds: number): string { const total = Math.max(0, Math.ceil(seconds)); return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }
  private static now(): string { const date = new Date(); return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; }
}
