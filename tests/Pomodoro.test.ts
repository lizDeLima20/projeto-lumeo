import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PomodoroCycle } from "../src/reader/pomodoro/PomodoroCycle";
import { ReadingDayTracker } from "../src/reader/pomodoro/ReadingDayTracker";
import { DEFAULT_READER_PREFERENCES } from "../src/reader/settings/ReaderPreferences";
import { ReaderPreferencesService } from "../src/reader/settings/ReaderPreferencesService";
import type { StorageAdapter } from "../src/services/StorageService";

class MemoryStorage implements StorageAdapter {
  public readonly values = new Map<string, unknown>();
  public async load<T>(key: string): Promise<T | null> { return (this.values.get(key) as T) ?? null; }
  public async save<T>(key: string, value: T): Promise<void> { this.values.set(key, JSON.parse(JSON.stringify(value)) as T); }
  public async remove(key: string): Promise<void> { this.values.delete(key); }
}

describe("Pomodoro Lumeo", () => {
  it("conta minutos de leitura, pausas e retornos do dia", async () => {
    const storage = new MemoryStorage();
    let clock = new Date("2026-09-17T20:05:00");
    const tracker = new ReadingDayTracker(storage, () => clock);
    await tracker.addReadingSeconds(90);
    await tracker.addReadingSeconds(30);
    await tracker.pause(); await tracker.resume(); await tracker.pause();
    const day = await tracker.today();
    assert.equal(day.readingSeconds, 120);
    assert.equal(day.pauses, 2); assert.equal(day.resumes, 1);
    assert.equal(day.firstReadAt, "20:05", "guarda o horário do início para oferecer o mesmo amanhã");
    // The next day starts from zero without losing the previous one.
    clock = new Date("2026-09-18T07:00:00");
    const tomorrow = await tracker.today();
    assert.equal(tomorrow.readingSeconds, 0);
    assert.equal(Object.keys(storage.values.get(ReadingDayTracker.KEY) as object).length, 1);
    await tracker.addReadingSeconds(10);
    assert.deepEqual(Object.keys(storage.values.get(ReadingDayTracker.KEY) as object), ["2026-09-17", "2026-09-18"]);
  });

  it("conta cada página uma vez por dia e avisa ao cumprir a meta", async () => {
    const tracker = new ReadingDayTracker(new MemoryStorage(), () => new Date("2026-09-17T09:00:00"));
    assert.equal((await tracker.pagesViewed("book-1", [2], 3)).goalReached, false);
    assert.equal((await tracker.pagesViewed("book-1", [3], 3)).goalReached, false);
    // Going back and forward over the same page must not count it again.
    assert.equal((await tracker.pagesViewed("book-1", [2], 3)).day.pagesRead, 2);
    const reached = await tracker.pagesViewed("book-1", [4], 3);
    assert.equal(reached.goalReached, true);
    assert.equal(reached.day.pagesRead, 3);
    // The question is asked once for that goal, not on every following turn.
    assert.equal((await tracker.pagesViewed("book-1", [5], 3)).goalReached, false);
    // A different book adds to the same day.
    assert.equal((await tracker.pagesViewed("book-2", [2], 3)).day.pagesRead, 5);
    assert.equal((await tracker.decideGoal("tomorrow")).goalDecision, "tomorrow");
  });

  it("alterna leitura e pausa, e só conta tempo de leitura na fase de foco", () => {
    const cycle = new PomodoroCycle(60, 30);
    assert.deepEqual(cycle.tick(40), { readingSeconds: 40, changed: false });
    assert.equal(cycle.phase, "focus"); assert.equal(cycle.remaining, 20);
    const finished = cycle.tick(30);
    assert.deepEqual(finished, { readingSeconds: 20, changed: true }, "o excedente não vira tempo de leitura");
    assert.equal(cycle.phase, "break"); assert.equal(cycle.remaining, 30);
    assert.deepEqual(cycle.tick(30), { readingSeconds: 0, changed: true });
    assert.equal(cycle.phase, "break-over");
    assert.deepEqual(cycle.tick(10), { readingSeconds: 0, changed: false }, "a pausa terminada espera o leitor");
    assert.equal(cycle.resume(), true); assert.equal(cycle.phase, "focus"); assert.equal(cycle.remaining, 60);
  });

  it("a pausa manual congela o tempo e o retorno continua o mesmo ciclo", () => {
    const cycle = new PomodoroCycle(60, 30);
    cycle.tick(25);
    assert.equal(cycle.pause(), true);
    assert.deepEqual(cycle.tick(120), { readingSeconds: 0, changed: false });
    assert.equal(cycle.resume(), true);
    assert.equal(cycle.remaining, 35, "volta de onde parou, sem reiniciar a leitura");
  });

  it("é opcional e guarda durações válidas", async () => {
    assert.equal(DEFAULT_READER_PREFERENCES.pomodoroEnabled, false);
    const service = new ReaderPreferencesService(new MemoryStorage());
    await service.restorePreferences();
    const saved = await service.savePreferences({ pomodoroEnabled: true, pomodoroFocusMinutes: 500, pomodoroBreakMinutes: 0, dailyPagesGoal: 12 });
    assert.equal(saved.pomodoroEnabled, true);
    assert.equal(saved.pomodoroFocusMinutes, 90); assert.equal(saved.pomodoroBreakMinutes, 1); assert.equal(saved.dailyPagesGoal, 12);
  });

  it("o leitor conta as páginas viradas e o painel oferece a opção", () => {
    const reader = readFileSync("src/views/ReaderView.ts", "utf8"), panel = readFileSync("src/views/ReaderSettingsPanel.ts", "utf8");
    assert.match(reader, /pagesViewed\(this\.bookId,\[this\.reflow\.currentPageNumber\]\)/);
    assert.match(reader, /if\(forward\)\{const first=this\.reflow\.currentPageNumber;void this\.pomodoro\?\.pagesViewed/);
    assert.match(reader, /state\.reason === "next"\) void this\.pomodoro\?\.pagesViewed/);
    assert.match(reader, /this\.pomodoro\?\.destroy\(\)/);
    assert.match(panel, /reader\.pomodoro\.enable/);
  });
});
