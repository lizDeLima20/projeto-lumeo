import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AnimationSettingsController } from "../src/reader/settings/AnimationSettingsController";
import { FontSettingsController } from "../src/reader/settings/FontSettingsController";
import { LayoutSettingsController } from "../src/reader/settings/LayoutSettingsController";
import { PaperSettingsController } from "../src/reader/settings/PaperSettingsController";
import { ReaderPreferencesService } from "../src/reader/settings/ReaderPreferencesService";
import type { StorageAdapter } from "../src/services/StorageService";

function setup() {
  const values=new Map<string,unknown>();
  const storage:StorageAdapter={load:async key=>(values.get(key)??null) as never,save:async(key,value)=>{values.set(key,value)},remove:async key=>{values.delete(key)}};
  const service=new ReaderPreferencesService(storage); return {service,values,fonts:new FontSettingsController(service),papers:new PaperSettingsController(service),layouts:new LayoutSettingsController(service),animations:new AnimationSettingsController(service)};
}
describe("ReaderPreferencesService",()=>{
  it("savePreferences, restorePreferences e preferencesPersist",async()=>{const {service,values}=setup();await service.restorePreferences();await service.savePreferences({fontFamily:"sans",paperTheme:"cream"});const restored=new ReaderPreferencesService({load:async key=>(values.get(key)??null) as never,save:async()=>{},remove:async()=>{}});await restored.restorePreferences();assert.equal(restored.preferences.fontFamily,"sans");assert.equal(restored.preferences.paperTheme,"cream");});
});
describe("controles de personalização",()=>{
  it("changeFont, changeFontSize e fontSizeLimits",async()=>{const {service,fonts}=setup();await service.restorePreferences();await fonts.changeFont("accessible");await fonts.changeFontSize(99);assert.equal(service.preferences.fontFamily,"accessible");assert.equal(service.preferences.fontSize,36);await fonts.changeFontSize(1);assert.equal(service.preferences.fontSize,13);});
  it("changePaper, changeBrightness e brightnessLimits",async()=>{const {service,papers}=setup();await service.restorePreferences();await papers.changePaper("sepia");await papers.changeBrightness(999);assert.equal(service.preferences.paperTheme,"sepia");assert.equal(service.preferences.readerBrightness,100);await papers.changeBrightness(1);assert.equal(service.preferences.readerBrightness,15);});
  it("bookRealModePersistsPaperAndSoftLight",async()=>{const {service,papers,values}=setup();await service.restorePreferences();await papers.enableBookReal();assert.equal(service.preferences.readingMode,"book-real");assert.equal(service.preferences.paperTheme,"ivory");assert.equal(service.preferences.readerBrightness,55);assert.equal(service.preferences.textColor,"soft-black");const restored=new ReaderPreferencesService({load:async key=>(values.get(key)??null) as never,save:async()=>{},remove:async()=>{}});await restored.restorePreferences();assert.equal(restored.preferences.readingMode,"book-real");});
  it("changeLayout, mobileRejectsTwoPages e desktopAllowsTwoPages",async()=>{const {service,layouts}=setup();await service.restorePreferences();await layouts.changeLayout("double",390);assert.equal(service.preferences.pageLayout,"single");await layouts.changeLayout("double",1440);assert.equal(service.preferences.pageLayout,"double");});
  it("changeAnimation",async()=>{const {service,animations}=setup();await service.restorePreferences();await animations.changeAnimation("slide");assert.equal(service.preferences.pageAnimation,"slide");});
});

describe("Livro Real visual",()=>{
  it("readerLightsPaperBehindTextWithoutGlobalOverlay",async()=>{const fs=await import("node:fs/promises"),css=await fs.readFile(new URL("../src/styles/reader.css",import.meta.url),"utf8"),view=await fs.readFile(new URL("../src/views/ReaderView.ts",import.meta.url),"utf8");assert.match(css,/--reader-paper-lit/);assert.match(css,/\.reflow-sheet>\*\{position:relative;z-index:1\}/);assert.match(css,/\.open-book-page>\*\{position:relative;z-index:1\}/);assert.doesNotMatch(css,/\.reader-dim-overlay/);assert.doesNotMatch(view,/reader-dim-overlay|dimOverlay|--reader-dim-opacity/);assert.doesNotMatch(css,/reader-stage[^{}]*filter|\.reader-stage\s*\{[^}]*filter/s);});
  it("pdfCanvasKeepsTransparentPageBackgroundWhenPossible",async()=>{const source=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../src/reader/PdfPageRenderer.ts",import.meta.url),"utf8"));assert.match(source,/alpha:\s*true/);assert.match(source,/background:\s*"rgba\(0,0,0,0\)"/);});
  it("coverOpeningUsesPaperBackgroundAndImageOnly",async()=>{const css=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../src/styles/reader.css",import.meta.url),"utf8"));assert.match(css,/body\.reader-mode #app-footer \{ display: none; \}/);assert.ok(css.includes(".reflow-sheet--cover{display:none;place-items:center;max-width:none;margin:0;padding:0;background:var(--reader-paper-lit)"));assert.match(css,/\.reader-cover-page\{[^{}]*background:transparent[^{}]*padding:0/s);assert.match(css,/\.reader-cover-page img\{[^{}]*width:100vw[^{}]*height:100dvh[^{}]*object-fit:contain/s);assert.match(css,/\.open-book-layout--cover\{[^{}]*box-shadow:none[^{}]*transform:none/s);assert.ok(css.includes(".desktop-book-reader:has(.open-book-layout--cover){inset:0;"));});
});
