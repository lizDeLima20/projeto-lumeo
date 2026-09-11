import type { AnnotationData } from "../models/Annotation";
import type { BookmarkData } from "../models/Bookmark";
import type { HighlightData } from "../models/Highlight";
import { I18nManager } from "../i18n/I18nManager";

export class StudyPanel {
  private panel: HTMLElement | null = null;
  private readonly i18n = I18nManager.shared;
  public get isOpen(): boolean { return Boolean(this.panel?.classList.contains("study-panel--open")); }
  public render(): HTMLElement { const panel = document.createElement("aside"); this.panel = panel; panel.className = "study-panel"; panel.setAttribute("aria-hidden", "true"); panel.setAttribute("aria-label", this.i18n.t("ui.study.marksTitle")); return panel; }
  public show(highlights: readonly HighlightData[], annotations: readonly AnnotationData[], bookmarks: readonly BookmarkData[], navigate: (anchor: HighlightData | BookmarkData) => void, remove: (kind: "highlight" | "annotation" | "bookmark", id: string) => void, edit: (annotation: AnnotationData) => void): void {
    if (!this.panel) return;
    const header = this.heading(this.i18n.t("ui.study.marksTitle")), close = document.createElement("button"); close.type = "button"; close.textContent = "×"; close.setAttribute("aria-label", this.i18n.t("ui.study.closeMarks")); close.addEventListener("click", () => this.close()); header.append(close);
    this.panel.replaceChildren(header, this.group(this.i18n.t("ui.study.highlights"), highlights.map(item => this.item(item.selectedText, annotations.find(note => note.highlightId === item.id)?.text, () => navigate(item), () => remove("highlight", item.id), item.color))), this.group(this.i18n.t("ui.study.notes"), annotations.map(item => this.item(item.text, undefined, () => edit(item), () => remove("annotation", item.id)))), this.group(this.i18n.t("ui.study.bookmarks"), bookmarks.map(item => this.item(item.label ?? this.i18n.t("ui.study.resumeHere"), this.i18n.t("ui.study.position", { position: item.anchor.logicalOffset }), () => navigate(item), () => remove("bookmark", item.id)))));
    this.panel.classList.add("study-panel--open"); this.panel.setAttribute("aria-hidden", "false");
  }
  public close(): void { this.panel?.classList.remove("study-panel--open"); this.panel?.setAttribute("aria-hidden", "true"); }
  private heading(text: string): HTMLElement { const header = document.createElement("header"), h = document.createElement("h2"); h.textContent = text; header.append(h); return header; }
  private group(title: string, items: HTMLElement[]): HTMLElement { const section = document.createElement("section"), h = document.createElement("h3"); h.textContent = title; section.append(h, ...(items.length ? items : [document.createTextNode(this.i18n.t("ui.study.noMark"))])); return section; }
  private item(text: string, note: string | undefined, open: () => void, remove: () => void, color?: string): HTMLElement { const row = document.createElement("article"); row.className = "study-item"; if (color) row.dataset.color = color; const button = document.createElement("button"); button.type = "button"; button.textContent = text; button.addEventListener("click", open); row.append(button); if (note) { const p = document.createElement("p"); p.textContent = note; row.append(p); } const del = document.createElement("button"); del.type = "button"; del.textContent = this.i18n.t("ui.common.remove"); del.addEventListener("click", remove); row.append(del); return row; }
}
