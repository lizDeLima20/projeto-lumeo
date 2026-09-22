import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("som nativo do Pomodoro Android", () => {
  it("usa o MP3 empacotado quando a conclusão acontece fora de um gesto", () => {
    const bridge = readFileSync("src/reader/pomodoro/PomodoroSoundPlayer.ts", "utf8");
    const plugin = readFileSync("android/app/src/main/java/com/lumeo/reader/ReaderSoundPlugin.java", "utf8");
    assert.match(bridge, /registerPlugin<ReaderSoundPlugin>\("ReaderSound"\)/);
    assert.match(bridge, /NativeReaderSound\.playReadingFinished/);
    assert.match(plugin, /R\.raw\.fim_da_leitura/);
    assert.match(plugin, /pomodoro\.sound\.played/);
  });
});
