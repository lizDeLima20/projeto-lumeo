import type { AnnotationData } from "../models/Annotation";
import type { BookmarkData } from "../models/Bookmark";
import type { HighlightData } from "../models/Highlight";
import { I18nManager } from "../i18n/I18nManager";

export class StudyPanel {
  private panel: HTMLElement | null = null;
  private readonly i18n = I18nManager.shared;
  public get isOpen(): boolean { return Boolean(this.panel?.classList.contains("study-panel--open")); }
  public render(): HTMLElement { const panel = document.createElement("aside"); this.panel = panel; panel.className = "study-panel"; panel.setAttribute("aria-hidden", "true"); panel.setAttribute("aria-label", this.i18n.t("ui.study.marksTitle")); return panel; }
  public show(highlights: readonly HighlightData[], annotations: readonly AnnotationData[], bookmarks: readonly BookmarkData[], navigate: (anchor: HighlightData | BookmarkData) => void, remove: (kind: "highlight" | "annotation" | "bookmark", id: string) => void, edit: (annotation: AnnotationData) => void, pageFor: (anchor: HighlightData | BookmarkData) => number): void {
    if (!this.panel) return;
    const header = this.heading(this.i18n.t("ui.study.marksTitle")), close = document.createElement("button"); close.type = "button"; close.textContent = "×"; close.setAttribute("aria-label", this.i18n.t("ui.study.closeMarks")); close.addEventListener("click", () => this.close()); header.append(close);
    const ordered = highlights.slice().sort((left, right) => pageFor(left) - pageFor(right) || left.startOffset - right.startOffset);
    const pages = new Map<number, HTMLElement[]>();
    ordered.forEach(item => {
      const page = pageFor(item), entries = pages.get(page) ?? [];
      entries.push(this.item(item, annotations.find(note => note.highlightId === item.id), page, () => navigate(item), () => remove("highlight", item.id), edit));
      pages.set(page, entries);
    });
    bookmarks.slice().sort((left, right) => pageFor(left) - pageFor(right)).forEach(item => {
      const page = pageFor(item), entries = pages.get(page) ?? [];
      entries.push(this.bookmark(item, page, () => navigate(item), () => remove("bookmark", item.id)));
      pages.set(page, entries);
    });
    const marks = document.createElement("section"); marks.className = "study-panel__marks";
    if (pages.size === 0) marks.append(document.createTextNode(this.i18n.t("ui.study.noMark")));
    [...pages.entries()].sort(([left], [right]) => left - right).forEach(([page, entries]) => {
      const group = document.createElement("section"); group.className = "study-panel__page";
      const heading = document.createElement("h3"); heading.textContent = this.i18n.t("ui.study.page", { page });
      group.append(heading, ...entries); marks.append(group);
    });
    const orphanNotes = annotations.filter(note => !highlights.some(mark => mark.id === note.highlightId));
    if (orphanNotes.length) {
      const notes = orphanNotes.map(note => this.orphanNote(note, () => edit(note), () => remove("annotation", note.id)));
      marks.append(this.group(this.i18n.t("ui.study.notes"), notes));
    }
    this.panel.replaceChildren(header, marks);
    this.panel.classList.add("study-panel--open"); this.panel.setAttribute("aria-hidden", "false");
  }
  public close(): void { this.panel?.classList.remove("study-panel--open"); this.panel?.setAttribute("aria-hidden", "true"); }
  private heading(text: string): HTMLElement { const header = document.createElement("header"), h = document.createElement("h2"); h.textContent = text; header.append(h); return header; }
  private group(title: string, items: HTMLElement[]): HTMLElement { const section = document.createElement("section"), h = document.createElement("h3"); h.textContent = title; section.append(h, ...(items.length ? items : [document.createTextNode(this.i18n.t("ui.study.noMark"))])); return section; }
  private item(mark: HighlightData, note: AnnotationData | undefined, page: number, open: () => void, remove: () => void, edit: (note: AnnotationData) => void): HTMLElement { const row = document.createElement("article"); row.className = "study-item"; row.dataset.color = mark.color; const button = document.createElement("button"); button.type = "button"; button.textContent = mark.selectedText; button.addEventListener("click", open); const meta = document.createElement("small"); meta.textContent = this.i18n.t("ui.study.page", { page }); row.append(meta, button); if (note?.text) row.append(this.detail(this.i18n.t("selection.note"), note.text, () => edit(note))); if (note?.definitionText) row.append(this.detail(this.i18n.t("selection.dictionary"), note.definitionText)); if (note?.translationText) row.append(this.detail(this.i18n.t("selection.translate"), note.translationText)); const del = document.createElement("button"); del.type = "button"; del.textContent = this.i18n.t("ui.common.remove"); del.addEventListener("click", remove); row.append(del); return row; }
  private bookmark(item: BookmarkData, page: number, open: () => void, remove: () => void): HTMLElement { const row = document.createElement("article"); row.className = "study-item"; const button = document.createElement("button"); button.type = "button"; button.textContent = item.label ?? this.i18n.t("ui.study.resumeHere"); button.addEventListener("click", open); const meta = document.createElement("small"); meta.textContent = this.i18n.t("ui.study.page", { page }); const del = document.createElement("button"); del.type = "button"; del.textContent = this.i18n.t("ui.common.remove"); del.addEventListener("click", remove); row.append(meta, button, del); return row; }
  private orphanNote(note: AnnotationData, open: () => void, remove: () => void): HTMLElement { const row = document.createElement("article"); row.className = "study-item"; const button = document.createElement("button"); button.type = "button"; button.textContent = note.text; button.addEventListener("click", open); const del = document.createElement("button"); del.type = "button"; del.textContent = this.i18n.t("ui.common.remove"); del.addEventListener("click", remove); row.append(button, del); return row; }
  private detail(label: string, value: string, action?: () => void): HTMLElement { const text = document.createElement(action ? "button" : "p"); text.textContent = `${label}: ${value}`; if (text instanceof HTMLButtonElement) { text.type = "button"; text.addEventListener("click", action!); } return text; }
}
