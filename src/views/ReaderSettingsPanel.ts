import type { ReaderPreferences, ReaderFontFamily, ReaderMargins, ReaderPageAnimation, ReaderPageLayout, ReaderPaper, ReaderSpacing, ReaderTextColor, ImageProfile } from "../reader/settings/ReaderPreferences";
import { AnimationSettingsController } from "../reader/settings/AnimationSettingsController";
import { FontSettingsController } from "../reader/settings/FontSettingsController";
import { LayoutSettingsController } from "../reader/settings/LayoutSettingsController";
import { PaperSettingsController } from "../reader/settings/PaperSettingsController";
import { ImageSettingsController, type ReaderImagePreset } from "../reader/settings/ImageSettingsController";
import { I18nManager, type SupportedLocale, type TranslationKey } from "../i18n/I18nManager";
import { ReaderDisplay } from "../services/ReaderDisplay";
import { ReadingReminder, type ReadingReminderDay, type ReadingReminderInput, type ReadingReminderItem } from "../services/ReadingReminder";
import type { Book } from "../models/Book";
import type { PomodoroSettingsController } from "../reader/settings/PomodoroSettingsController";
import type { ReadingDay } from "../reader/pomodoro/ReadingDayTracker";

export interface PomodoroSettings { controller: PomodoroSettingsController; today: () => Promise<Readonly<ReadingDay>>; }

export class ReaderSettingsPanel {
  private panel: HTMLElement | null = null;
  private backdrop: HTMLButtonElement | null = null;
  private readonly i18n = I18nManager.shared;
  public constructor(private readonly preferences: () => Readonly<ReaderPreferences>, private readonly adaptive: boolean,
    private readonly fonts: FontSettingsController, private readonly papers: PaperSettingsController,
    private readonly layouts: LayoutSettingsController, private readonly animations: AnimationSettingsController, private readonly images: ImageSettingsController,
    private readonly onChange: (repaginate: boolean) => void, private readonly onVisibilityChange: (open: boolean) => void,
    private readonly pomodoro?: PomodoroSettings, private readonly reminderBooks: readonly Pick<Book, "id" | "title" | "author" | "cover">[] = []) {}
  public render(): DocumentFragment {
    const fragment = document.createDocumentFragment(); this.backdrop = document.createElement("button");
    this.backdrop.type = "button"; this.backdrop.className = "reader-settings-backdrop"; this.backdrop.setAttribute("aria-label", this.i18n.t("reader.closeSettings")); this.backdrop.addEventListener("click", () => this.close());
    const panel = document.createElement("aside"); this.panel = panel; panel.id = "reader-settings"; panel.className = "reader-settings"; panel.setAttribute("aria-hidden", "true"); panel.setAttribute("aria-label", this.i18n.t("reader.customization"));
    const header = document.createElement("header"); header.className = "reader-settings__header"; const heading=document.createElement("h2");heading.textContent=this.i18n.t("reader.reading");header.append(heading);
    const close = this.button("×", "Fechar painel", () => this.close()); close.className = "reader-settings__close"; header.append(close); panel.append(header);
    panel.append(this.languageSection(), this.textSection(), this.paperSection(), this.layoutSection(), this.imageSection(), this.animationSection());
    if (this.pomodoro) panel.append(this.pomodoroSection(this.pomodoro));
    if (ReadingReminder.available) panel.append(this.readingReminderSection());
    fragment.append(this.backdrop, panel); return fragment;
  }
  public open(): void { this.panel?.classList.add("reader-settings--open"); this.backdrop?.classList.add("reader-settings-backdrop--open"); this.panel?.setAttribute("aria-hidden", "false"); this.onVisibilityChange(true); this.panel?.querySelector<HTMLElement>("button,select,input")?.focus(); }
  public close(): void { this.panel?.classList.remove("reader-settings--open"); this.backdrop?.classList.remove("reader-settings-backdrop--open"); this.panel?.setAttribute("aria-hidden", "true"); this.onVisibilityChange(false); }
  public toggle(): boolean { const open = !this.panel?.classList.contains("reader-settings--open"); open ? this.open() : this.close(); return open; }
  public get isOpen(): boolean { return Boolean(this.panel?.classList.contains("reader-settings--open")); }
  /** Rebuilds only settings chrome; it never touches the active book or reading anchor. */
  public refresh(): void { const parent=this.panel?.parentElement,wasOpen=this.isOpen;this.backdrop?.remove();this.panel?.remove();if(!parent)return;parent.append(this.render());if(wasOpen)this.open(); }
  private textSection(): HTMLElement {
    const body = this.section(this.i18n.t("reader.text"), true); if (!this.adaptive) { const note = document.createElement("p"); note.className = "reader-settings__note"; note.textContent = this.i18n.t("ui.reader.adaptiveOnly"); body.append(note); return body; }
    body.append(this.select(this.i18n.t("reader.font"), [["book",this.i18n.t("reader.font.book")],["classic",this.i18n.t("reader.font.classic")],["modern",this.i18n.t("reader.font.modern")],["sans",this.i18n.t("reader.font.sans")],["accessible",this.i18n.t("reader.font.accessible")]], this.preferences().fontFamily, "reader-font-preview", value => void this.changed(this.fonts.changeFont(value as ReaderFontFamily), true)),
      this.fontSteps(),
      this.segment(this.i18n.t("reader.weight"), [["300",this.i18n.t("reader.weight.light")],["400",this.i18n.t("reader.weight.normal")],["700",this.i18n.t("reader.weight.strong")]], String(this.preferences().fontWeight), value => void this.changed(this.fonts.changeFontWeight(Number(value) as 300|400|700), true)),
      this.segment(this.i18n.t("reader.color"), [["soft-black",this.i18n.t("reader.color.softBlack")],["graphite",this.i18n.t("reader.color.graphite")],["dark-brown",this.i18n.t("reader.color.darkBrown")],["night-beige",this.i18n.t("reader.color.nightBeige")]], this.preferences().textColor, value => void this.changed(this.fonts.changeTextColor(value as ReaderTextColor), false)),
      this.segment(this.i18n.t("reader.spacing"), [["compact",this.i18n.t("reader.spacing.compact")],["normal",this.i18n.t("reader.spacing.normal")],["comfortable",this.i18n.t("reader.spacing.comfortable")],["wide",this.i18n.t("reader.spacing.wide")]], this.preferences().lineSpacing, value => void this.changed(this.fonts.changeSpacing(value as ReaderSpacing), true)));
    return body;
  }
  private languageSection():HTMLElement{const body=this.section(this.i18n.t("reader.language"));body.append(this.select(this.i18n.t("reader.language"),this.i18n.options().map(option=>[option.value,option.label]),this.i18n.locale,"reader-language-select",value=>void this.i18n.setLocale(value as SupportedLocale)));return body;}
  private paperSection(): HTMLElement { return ReaderDisplay.available ? this.readerThemeSection() : this.webPaperSection(); }
  /** Papel, Claro, Sépia, Escuro - the same four themes on every platform, each shown with
   *  a small swatch of its real page colour so the choice is not just a word. */
  private static readonly themes: ReadonlyArray<[string, TranslationKey, string]> = [["paper", "reader.theme.paper", "#f6f1e7"], ["pure-white", "reader.theme.light", "#fbfbf9"], ["sepia", "reader.theme.sepia", "#f1e3c8"], ["dark", "reader.theme.dark", "#1c1b19"]];
  private themeSegment(modifier = ""): HTMLElement {
    const themes = ReaderSettingsPanel.themes;
    const current = themes.some(([key]) => key === this.preferences().paperTheme) ? this.preferences().paperTheme : "paper";
    const segment = this.segment(this.i18n.t("reader.theme"), themes.map(([key, label]) => [key, this.i18n.t(label)]), current, value => void this.changed(this.papers.changePaper(value as ReaderPaper), false), `paper-options reader-theme-options ${modifier}`.trim());
    segment.querySelectorAll<HTMLInputElement>("input").forEach((input) => { const swatch = document.createElement("span"); swatch.className = "reader-theme-swatch"; swatch.style.background = themes.find(([key]) => key === input.value)?.[2] ?? ""; swatch.setAttribute("aria-hidden", "true"); input.after(swatch); });
    return segment;
  }
  /** Android e-reader: the reading theme and the window's own brightness. */
  private readerThemeSection(): HTMLElement {
    const body = this.section(this.i18n.t("reader.theme"));
    body.append(this.themeSegment(), this.brightnessControl());
    return body;
  }
  /** "Brilho de leitura": live on the window while dragging, saved when released. */
  private brightnessControl(): HTMLElement {
    const field = document.createElement("div"); field.className = "reader-setting-field reader-brightness-field";
    field.append(this.label(this.i18n.t("reader.screenBrightness")));
    const system = document.createElement("label"); system.className = "reader-pomodoro-settings__toggle";
    const follow = document.createElement("input"); follow.type = "checkbox"; follow.checked = this.preferences().screenBrightness === null;
    system.append(follow, document.createTextNode(this.i18n.t("reader.screenBrightness.system")));
    const row = document.createElement("span"); row.className = "reader-slider";
    const input = document.createElement("input"); input.type = "range"; input.className = "reader-brightness";
    input.min = String(ReaderDisplay.minPercent); input.max = String(ReaderDisplay.maxPercent); input.step = "1";
    input.value = String(this.preferences().screenBrightness ?? 60); input.disabled = follow.checked; input.setAttribute("aria-label", this.i18n.t("reader.screenBrightness"));
    row.append(this.i18n.t("reader.screenBrightness.min"), input, this.i18n.t("reader.screenBrightness.max"));
    const help = document.createElement("p"); help.className = "reader-settings__note"; help.textContent = this.i18n.t("reader.screenBrightness.help");
    input.addEventListener("input", () => void ReaderDisplay.apply(Number(input.value)));
    input.addEventListener("change", () => void this.papers.changeScreenBrightness(Number(input.value)));
    follow.addEventListener("change", () => {
      input.disabled = follow.checked;
      const value = follow.checked ? null : Number(input.value);
      void ReaderDisplay.apply(value); void this.papers.changeScreenBrightness(value);
    });
    field.append(system, row, help);
    return field;
  }
  /** A− / A+ in single steps, with the size shown between them. */
  private fontSteps(): HTMLElement {
    const field = document.createElement("div"); field.className = "reader-setting-field";
    field.append(this.label(this.i18n.t("reader.fontSize")));
    const row = document.createElement("div"); row.className = "reader-font-steps";
    const size = document.createElement("output"); size.value = `${this.preferences().fontSize} px`;
    const step = (delta: number) => { const next = Math.min(36, Math.max(13, this.preferences().fontSize + delta)); if (next === this.preferences().fontSize) return; size.value = `${next} px`; void this.changed(this.fonts.changeFontSize(next), true); };
    const smaller = this.button("A−", this.i18n.t("reader.fontSize.decrease"), () => step(-1)), larger = this.button("A+", this.i18n.t("reader.fontSize.increase"), () => step(1));
    larger.style.fontSize = "1.15rem";
    row.append(smaller, size, larger); field.append(row); return field;
  }
  private webPaperSection(): HTMLElement { const body=this.section(this.i18n.t("reader.paper")); const real=this.button(this.i18n.t("reader.bookReal"),this.i18n.t("reader.bookReal"),()=>void this.changed(this.papers.enableBookReal(),false));real.className=`button button--secondary reader-book-real${this.preferences().readingMode==="book-real"?" reader-book-real--active":""}`;const help=document.createElement("p");help.className="reader-settings__note";help.textContent=this.i18n.t("reader.bookReal.help"); body.append(this.themeSegment(),this.slider(this.i18n.t("reader.brightness"),15,100,this.preferences().readerBrightness,"15%","100%",value=>void this.changed(this.papers.changeBrightness(value),false)),real,help);return body; }
  private layoutSection():HTMLElement { const body=this.section(this.i18n.t("reader.layout"));const doubleAllowed=this.layouts.allowsTwoPages(window.innerWidth);const layout=this.segment(this.i18n.t("reader.pages"),[["single",this.i18n.t("reader.onePage")],["double",this.i18n.t("reader.twoPages")]],doubleAllowed?this.preferences().pageLayout:"single",value=>void this.changed(this.layouts.changeLayout(value as ReaderPageLayout,window.innerWidth),true));const double=layout.querySelector<HTMLInputElement>('input[value="double"]');if(double){double.disabled=!doubleAllowed;double.parentElement?.classList.toggle("is-disabled",!doubleAllowed);double.parentElement?.setAttribute("title",doubleAllowed?"":this.i18n.t("ui.reader.spreadAvailable"));}body.append(layout);if(this.adaptive)body.append(this.segment(this.i18n.t("reader.margins"),[["narrow",this.i18n.t("reader.margin.narrow")],["normal",this.i18n.t("reader.margin.normal")],["wide",this.i18n.t("reader.margin.wide")]],this.preferences().margins,value=>void this.changed(this.layouts.changeMargins(value as ReaderMargins),true)));return body; }
  private animationSection():HTMLElement { const body=this.section(this.i18n.t("reader.animation"));body.append(this.segment(this.i18n.t("reader.pageTurn"),[["page-turn",this.i18n.t("reader.animation.pageTurn")],["slide",this.i18n.t("reader.animation.slide")],["carousel",this.i18n.t("reader.animation.carousel")]],this.preferences().pageAnimation,value=>void this.changed(this.animations.changeAnimation(value as ReaderPageAnimation),false)));return body; }
  /** Pomodoro Lumeo: on/off, focus and break lengths, the daily page goal, and today's numbers. */
  private pomodoroSection(pomodoro: PomodoroSettings): HTMLElement {
    const body = this.section(this.i18n.t("reader.pomodoro.title")); body.classList.add("reader-pomodoro-settings");
    const help = document.createElement("p"); help.className = "reader-settings__note"; help.textContent = this.i18n.t("reader.pomodoro.help");
    const toggle = document.createElement("label"); toggle.className = "reader-setting-field reader-pomodoro-settings__toggle";
    const enabled = document.createElement("input"); enabled.type = "checkbox"; enabled.checked = this.preferences().pomodoroEnabled;
    toggle.append(enabled, document.createTextNode(this.i18n.t("reader.pomodoro.enable")));
    const fields = document.createElement("div"); fields.className = "reader-pomodoro-settings__fields"; fields.hidden = !enabled.checked;
    enabled.addEventListener("change", () => { fields.hidden = !enabled.checked; void this.changed(pomodoro.controller.toggle(enabled.checked), false); });
    // Exactly one goal drives a session: Tempo shows its own two fields, Páginas its own one.
    // Never both at once - that is the whole point of choosing a type first.
    const timeFields = document.createElement("div"); timeFields.className = "reader-pomodoro-settings__group";
    timeFields.append(
      this.number(this.i18n.t("reader.pomodoro.focus"), 5, 90, this.preferences().pomodoroFocusMinutes, (value) => void this.changed(pomodoro.controller.changeFocus(value), false)),
      this.number(this.i18n.t("reader.pomodoro.break"), 1, 30, this.preferences().pomodoroBreakMinutes, (value) => void this.changed(pomodoro.controller.changeBreak(value), false)));
    const pagesFields = document.createElement("div"); pagesFields.className = "reader-pomodoro-settings__group";
    pagesFields.append(
      this.number(this.i18n.t("reader.pomodoro.goal"), 1, 500, this.preferences().dailyPagesGoal, (value) => void this.changed(pomodoro.controller.changeDailyGoal(value), false)),
      this.number(this.i18n.t("reader.pomodoro.break"), 1, 30, this.preferences().pomodoroBreakMinutes, (value) => void this.changed(pomodoro.controller.changeBreak(value), false)));
    const showGoalType = (value: "time" | "pages"): void => { timeFields.hidden = value !== "time"; pagesFields.hidden = value !== "pages"; };
    const goalType = this.segment(this.i18n.t("reader.pomodoro.goalType"), [["time", this.i18n.t("reader.pomodoro.goalType.time")], ["pages", this.i18n.t("reader.pomodoro.goalType.pages")]],
      this.preferences().pomodoroGoalType, (value) => { showGoalType(value as "time" | "pages"); void this.changed(pomodoro.controller.changeGoalType(value as "time" | "pages"), false); });
    showGoalType(this.preferences().pomodoroGoalType);
    fields.append(goalType, timeFields, pagesFields);
    const today = document.createElement("p"); today.className = "reader-pomodoro-settings__today"; today.setAttribute("aria-live", "polite");
    void pomodoro.today().then((day) => {
      const count = (key: TranslationKey, value: number) => { const [one = "", other] = this.i18n.t(key, { count: value }).split("|"); return value === 1 ? one : other ?? one; };
      today.textContent = `${this.i18n.t("reader.pomodoro.today")}: ${[this.i18n.t("reader.pomodoro.minutes", { count: Math.floor(day.readingSeconds / 60) }), count("reader.pomodoro.pages", day.pagesRead), count("reader.pomodoro.pauses", day.pauses), count("reader.pomodoro.resumes", day.resumes)].join(" · ")}`;
    }).catch(() => undefined);
    body.append(help, toggle, fields, today);
    return body;
  }
  /** Android-only: the native plugin owns persistence and AlarmManager, so it still fires after WebView shutdown. */
  private readingReminderSection(): HTMLElement {
    const body = this.section(this.i18n.t("reader.reminder.title")); body.classList.add("reader-reminder-settings");
    const fields = document.createElement("div"); fields.className = "reader-pomodoro-settings__fields"; fields.hidden = true;
    const time = document.createElement("input"); time.type = "time"; time.className = "input"; time.value = "09:00"; time.setAttribute("aria-label", this.i18n.t("reader.reminder.time"));
    const timeField = document.createElement("label"); timeField.className = "reader-setting-field"; timeField.append(this.label(this.i18n.t("reader.reminder.time")), time);
    const days = document.createElement("fieldset"); days.className = "reader-reminder-settings__days"; const legend = document.createElement("legend"); legend.textContent = this.i18n.t("reader.reminder.days"); days.append(legend);
    const inputs = new Map<ReadingReminderDay, HTMLInputElement>();
    const labels = ["reader.reminder.sun", "reader.reminder.mon", "reader.reminder.tue", "reader.reminder.wed", "reader.reminder.thu", "reader.reminder.fri", "reader.reminder.sat"] as const;
    labels.forEach((key, index) => { const day = (index + 1) as ReadingReminderDay, label = document.createElement("label"), input = document.createElement("input"); input.type = "checkbox"; input.checked = day >= 2 && day <= 6; input.value = String(day); label.append(input, document.createTextNode(this.i18n.t(key))); inputs.set(day, input); days.append(label); });
    const target = document.createElement("div"); target.className = "reader-reminder-settings__books";
    const library = document.createElement("label"), libraryInput = document.createElement("input"); libraryInput.type = "radio"; libraryInput.name = "reading-reminder-target"; libraryInput.value = "library"; libraryInput.checked = true; library.append(libraryInput, document.createTextNode(this.i18n.t("reader.reminder.library")));
    target.append(library);
    this.reminderBooks.forEach(book => { const label = document.createElement("label"), input = document.createElement("input"), image = document.createElement("img"), copy = document.createElement("span"); input.type = "radio"; input.name = "reading-reminder-target"; input.value = book.id; image.src = book.cover || "/icons/lumeo-logo.png"; image.alt = ""; image.loading = "lazy"; copy.textContent = `${book.title}${book.author ? ` — ${book.author}` : ""}`; label.append(input, image, copy); target.append(label); });
    const actions = document.createElement("div"); actions.className = "reader-pomodoro-dialog__actions";
    const add = document.createElement("button"); add.type = "button"; add.className = "button button--primary"; add.textContent = this.i18n.t("reader.reminder.add");
    const status = document.createElement("p"); status.className = "reader-settings__note"; status.setAttribute("aria-live", "polite");
    const list = document.createElement("div"); list.className = "reader-reminder-settings__list";
    let reminders: ReadingReminderItem[] = [];
    const value = (): ReadingReminderInput | null => {
      const parts = time.value.split(":"), hour = Number(parts[0]), minute = Number(parts[1]), selected = [...inputs].filter(([, input]) => input.checked).map(([day]) => day);
      const selectedTarget = target.querySelector<HTMLInputElement>("input:checked")?.value ?? "library";
      const book = this.reminderBooks.find(item => item.id === selectedTarget);
      return Number.isInteger(hour) && Number.isInteger(minute) && selected.length ? { hour, minute, days: selected, targetType: book ? "book" : "library", bookId: book?.id, bookTitle: book?.title } : null;
    };
    const renderList = (): void => {
      list.replaceChildren();
      if (!reminders.length) { list.append(this.createNote(this.i18n.t("reader.reminder.empty"))); return; }
      reminders.forEach(reminder => {
        const row = document.createElement("article"); row.className = "reader-reminder-settings__item";
        const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.checked = reminder.enabled; toggle.setAttribute("aria-label", this.i18n.t("reader.reminder.enable"));
        toggle.addEventListener("change", async () => { const state = await ReadingReminder.setReminderEnabled(reminder.id, toggle.checked); if (state?.reminders) { reminders = [...state.reminders]; renderList(); } });
        const text = document.createElement("span"); text.textContent = `${String(reminder.hour).padStart(2, "0")}:${String(reminder.minute).padStart(2, "0")} · ${reminder.targetType === "book" ? reminder.bookTitle ?? this.i18n.t("reader.reminder.book") : this.i18n.t("reader.reminder.library")}`;
        const edit = document.createElement("button"); edit.type = "button"; edit.textContent = this.i18n.t("ui.common.edit"); edit.addEventListener("click", () => { fields.hidden = false; time.value = `${String(reminder.hour).padStart(2, "0")}:${String(reminder.minute).padStart(2, "0")}`; inputs.forEach((input, day) => { input.checked = reminder.days.includes(day); }); const radio = target.querySelector<HTMLInputElement>(`input[value="${CSS.escape(reminder.bookId ?? "library")}"]`) ?? libraryInput; radio.checked = true; add.dataset.editing = reminder.id; add.textContent = this.i18n.t("ui.common.save"); });
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = this.i18n.t("ui.common.delete"); remove.addEventListener("click", async () => { const state = await ReadingReminder.deleteReminder(reminder.id); reminders = [...(state?.reminders ?? [])]; renderList(); });
        row.append(toggle, text, edit, remove); list.append(row);
      });
    };
    add.addEventListener("click", async () => {
      if (fields.hidden) { fields.hidden = false; return; }
      const next = value(); if (!next) { status.textContent = this.i18n.t("reader.reminder.chooseDay"); return; }
      const editing = add.dataset.editing;
      const updated = editing ? reminders.map(item => item.id === editing ? { ...next, id: editing, enabled: true } : item) : [...reminders, { ...next, enabled: true }];
      const saved = await ReadingReminder.saveReminders(updated);
      if (!saved) { status.textContent = this.i18n.t("reader.reminder.permission"); return; }
      reminders = [...(saved.state.reminders ?? [])]; fields.hidden = true; delete add.dataset.editing; add.textContent = this.i18n.t("reader.reminder.add");
      status.textContent = this.i18n.t("reader.reminder.saved"); renderList();
    });
    actions.append(add);
    fields.append(timeField, days, target); body.append(actions, fields, list, status);
    void ReadingReminder.state().then(saved => { reminders = [...(saved?.reminders ?? [])]; renderList(); }).catch(() => renderList());
    return body;
  }
  private createNote(text: string): HTMLElement { const note = document.createElement("p"); note.className = "reader-settings__note"; note.textContent = text; return note; }
  private number(label: string, min: number, max: number, value: number, onChange: (value: number) => void): HTMLElement {
    const field = document.createElement("label"); field.className = "reader-setting-field reader-pomodoro-settings__number"; field.append(this.label(label));
    const input = document.createElement("input"); input.type = "number"; input.className = "input"; input.inputMode = "numeric"; input.min = String(min); input.max = String(max); input.step = "1"; input.value = String(value);
    input.addEventListener("change", () => { const next = Math.min(max, Math.max(min, Math.round(Number(input.value) || value))); input.value = String(next); onChange(next); });
    field.append(input); return field;
  }
  private imageSection():HTMLElement{const body=this.section(this.i18n.t("reader.image"));body.append(this.segment(this.i18n.t("reader.scan.preset"),[["original",this.i18n.t("reader.scan.original")],["scannedText",this.i18n.t("reader.scan.scannedText")],["oldDocument",this.i18n.t("reader.scan.oldDocument")],["manga",this.i18n.t("reader.scan.manga")]],this.preferences().imagePreset,value=>void this.changed(this.images.changePreset(value as ReaderImagePreset),false),"paper-options"),this.segment(this.i18n.t("reader.imageProfile"),[["normal",this.i18n.t("reader.scan.normal")],["high-contrast",this.i18n.t("reader.scan.highContrast")],["soft",this.i18n.t("reader.scan.soft")]],this.preferences().imageProfile,value=>void this.changed(this.images.changeProfile(value as ImageProfile),false),"paper-options"));return body;}
  private section(title:string,_open=false):HTMLElement { const body=document.createElement("section");body.className="reader-settings__section-body";const heading=document.createElement("h3");heading.textContent=title;body.append(heading);return body; }
  private select(label:string,options:string[][],value:string,className:string,onChange:(value:string)=>void):HTMLElement { const field=document.createElement("label");field.className="reader-setting-field";field.append(this.label(label));const select=document.createElement("select");select.className=`input ${className}`;select.setAttribute("aria-label",label);options.forEach(([key,text])=>{if(key&&text)select.append(new Option(text,key));});select.value=value;select.addEventListener("change",()=>onChange(select.value));field.append(select);return field; }
  private slider(label:string,min:number,max:number,value:number,left:string,right:string,onInput:(value:number)=>void):HTMLElement { const field=document.createElement("label");field.className="reader-setting-field";field.append(this.label(label));const row=document.createElement("span");row.className="reader-slider";row.append(left);const input=document.createElement("input");input.type="range";input.min=String(min);input.max=String(max);input.value=String(value);input.setAttribute("aria-label",label);input.addEventListener("input",()=>onInput(Number(input.value)));row.append(input,right);field.append(row);return field; }
  private segment(label:string,options:string[][],value:string,onChange:(value:string)=>void,className=""):HTMLElement { const field=document.createElement("fieldset");field.className=`reader-setting-field reader-segments ${className}`;const legend=document.createElement("legend");legend.textContent=label;field.append(legend);options.forEach(([key,text])=>{if(!key||!text)return;const item=document.createElement("label");const input=document.createElement("input");input.type="radio";input.name=`reader-${label.toLowerCase().replace(/\s/g,"-")}`;input.value=key;input.checked=key===value;input.addEventListener("change",()=>onChange(key));item.append(input,document.createTextNode(text));field.append(item);});return field; }
  private label(text:string):HTMLElement { const span=document.createElement("span");span.className="field__label";span.textContent=text;return span; }
  private button(text:string,label:string,action:()=>void):HTMLButtonElement { const button=document.createElement("button");button.type="button";button.textContent=text;button.setAttribute("aria-label",label);button.addEventListener("click",action);return button; }
  private async changed(change:Promise<Readonly<ReaderPreferences>>,repaginate:boolean):Promise<void>{await change;this.onChange(repaginate);}
}
