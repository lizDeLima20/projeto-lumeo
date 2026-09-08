import type { LimaAnchor, LimaChapter } from "../lima/LimaDocument";
import type { ChapterStudySheet } from "../reader/study/ChapterStudySheet";
import { ChapterStudyController, type SaveStatus } from "../reader/study/ChapterStudyController";
import type { StudyEntry } from "../reader/study/StudyNotebook";

export class ChapterQuestionReview {
  private index = 0;
  public constructor(private readonly sheet: ChapterStudySheet) {}
  public current() { return this.sheet.questions[this.index] ?? null; }
  public next() { this.index = Math.min(this.sheet.questions.length - 1, this.index + 1); return this.current(); }
  public previous() { this.index = Math.max(0, this.index - 1); return this.current(); }
}

export class ChapterStudyView {
  private root: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private readonly unsubscribe: () => void;
  public constructor(private readonly controller: ChapterStudyController, private readonly markings: (chapterId: string) => Promise<StudyEntry[]>, private readonly navigate: (anchor: LimaAnchor, text?: string) => void) {
    this.unsubscribe = controller.subscribe((sheet, status) => void this.paint(sheet, status));
  }
  public render(): HTMLElement {
    const root = document.createElement("section"); this.root = root; root.className = "chapter-study-view"; root.setAttribute("aria-hidden", "true");
    const header = document.createElement("header"), title = document.createElement("h2"); title.textContent = "Fichário do capítulo"; this.status = document.createElement("small"); header.append(title, this.status, this.button("×", () => this.close(), "Fechar fichário"));
    const search = document.createElement("input"); search.type = "search"; search.placeholder = "Buscar neste fichário"; search.addEventListener("input", () => { const result = this.controller.search(search.value); if (result) void this.paint(result, "idle"); });
    this.content = document.createElement("div"); this.content.className = "chapter-study-content"; root.append(header, search, this.content); return root;
  }
  public async open(chapter: LimaChapter): Promise<void> { this.root?.classList.add("chapter-study-view--open"); this.root?.setAttribute("aria-hidden", "false"); const title = this.root?.querySelector("h2"); if (title) title.textContent = chapter.title; await this.controller.loadByChapter(chapter.id); }
  public close(): void { void this.controller.saveNow(); this.root?.classList.remove("chapter-study-view--open"); this.root?.setAttribute("aria-hidden", "true"); }
  public destroy(): void { this.unsubscribe(); this.controller.destroy(); }
  public addSelection(kind: "topic" | "question" | "doubt", anchor: LimaAnchor, text: string): void { if (kind === "topic") this.controller.addTopic(text, anchor, text); else if (kind === "question") this.controller.addQuestion(text, "", anchor, text); else this.controller.addDoubt(text, "", anchor, text); }
  private async paint(sheet: ChapterStudySheet, status: SaveStatus): Promise<void> {
    if (!this.content) return; if (this.status) this.status.textContent = status === "saving" ? "Salvando…" : status === "saved" ? "Salvo" : "";
    const created = document.createElement("div"), references = document.createElement("aside"); created.className = "chapter-study-created"; references.className = "chapter-study-references";
    created.append(this.summary(sheet), this.topics(sheet), this.questions(sheet), this.doubts(sheet)); references.append(await this.referenceSection(sheet.chapterId), this.reviewControl(sheet)); this.content.replaceChildren(created, references);
  }
  private summary(sheet: ChapterStudySheet): HTMLElement { const section = this.section("Meu resumo"), input = document.createElement("textarea"); input.rows = 7; input.placeholder = "Escreva com suas palavras…"; input.value = sheet.summary; input.addEventListener("input", () => this.controller.updateSummary(input.value)); section.append(input); return section; }
  private topics(sheet: ChapterStudySheet): HTMLElement { const section = this.section("Tópicos principais"); sheet.topics.forEach((item, index) => { const row = this.row(), input = document.createElement("input"); input.value = item.text; input.addEventListener("input", () => this.controller.editTopic(item.id, input.value)); row.append(input, this.button("↑", () => this.controller.reorderTopics(item.id, -1), "Subir", index === 0), this.button("↓", () => this.controller.reorderTopics(item.id, 1), "Descer", index === sheet.topics.length - 1), this.anchor(item.sourceAnchor, item.sourceText), this.button("Excluir", () => this.controller.deleteTopic(item.id))); section.append(row); }); section.append(this.addForm("Novo tópico", value => this.controller.addTopic(value))); return section; }
  private questions(sheet: ChapterStudySheet): HTMLElement { const section = this.section("Perguntas"); sheet.questions.forEach(item => { const row = this.row(), question = document.createElement("input"), answer = document.createElement("textarea"); question.value = item.question; answer.value = item.answer?.text ?? ""; answer.placeholder = "Resposta opcional"; const edit = () => this.controller.editQuestion(item.id, question.value, answer.value); question.addEventListener("input", edit); answer.addEventListener("input", edit); row.append(question, answer, this.anchor(item.sourceAnchor, item.sourceText), this.button("Excluir", () => this.controller.deleteQuestion(item.id))); section.append(row); }); const form = document.createElement("form"), question = document.createElement("input"), answer = document.createElement("input"); question.placeholder = "Nova pergunta"; answer.placeholder = "Resposta opcional"; form.append(question, answer, this.button("Adicionar", () => undefined)); form.addEventListener("submit", event => { event.preventDefault(); this.controller.addQuestion(question.value, answer.value); }); section.append(form); return section; }
  private doubts(sheet: ChapterStudySheet): HTMLElement { const section = this.section("Dúvidas"); sheet.doubts.forEach(item => { const row = this.row(), done = document.createElement("input"), text = document.createElement("input"), note = document.createElement("input"); done.type = "checkbox"; done.checked = item.resolved; text.value = item.text; note.value = item.observation ?? ""; note.placeholder = "Observação opcional"; done.addEventListener("change", () => this.controller.resolveDoubt(item.id, done.checked)); const edit = () => this.controller.editDoubt(item.id, text.value, note.value); text.addEventListener("input", edit); note.addEventListener("input", edit); row.append(done, text, note, this.anchor(item.sourceAnchor, item.sourceText), this.button("Excluir", () => this.controller.deleteDoubt(item.id))); section.append(row); }); section.append(this.addForm("Registrar dúvida", value => this.controller.addDoubt(value))); return section; }
  private async referenceSection(chapterId: string): Promise<HTMLElement> { const section = this.section("Marcações deste capítulo"), entries = await this.markings(chapterId); if (!entries.length) section.append("Nenhuma marcação neste capítulo."); entries.forEach(entry => section.append(this.button(entry.noteText || entry.selectedText, () => this.navigate(entry.anchor, entry.selectedText)))); return section; }
  private reviewControl(sheet: ChapterStudySheet): HTMLElement { const section = this.section("Revisar capítulo"); section.append(this.button("Iniciar revisão", () => this.review(sheet))); return section; }
  private review(sheet: ChapterStudySheet): void { if (!this.content) return; const review = new ChapterQuestionReview(sheet), card = document.createElement("article"), paint = () => { const item = review.current(); card.replaceChildren(); if (!item) { card.append("Nenhuma pergunta criada.", this.button("Voltar", () => void this.paint(sheet, "idle"))); return; } const title = document.createElement("h3"), answer = document.createElement("p"); title.textContent = item.question; answer.textContent = item.answer?.text || "Sem resposta registrada."; answer.hidden = true; card.append(title, this.button("Ver resposta", () => { answer.hidden = false; }), answer, this.button("Anterior", () => { review.previous(); paint(); }), this.button("Próxima", () => { review.next(); paint(); }), this.button("Sair", () => void this.paint(sheet, "idle"))); }; paint(); this.content.replaceChildren(card); }
  private addForm(placeholder: string, add: (value: string) => void): HTMLFormElement { const form = document.createElement("form"), input = document.createElement("input"); input.placeholder = placeholder; form.append(input, this.button("Adicionar", () => undefined)); form.addEventListener("submit", event => { event.preventDefault(); add(input.value); input.value = ""; }); return form; }
  private anchor(value?: LimaAnchor, text?: string): HTMLElement { return value ? this.button("Abrir trecho", () => this.navigate(value, text)) : document.createElement("span"); }
  private section(title: string): HTMLElement { const section = document.createElement("section"), heading = document.createElement("h3"); heading.textContent = title; section.append(heading); return section; }
  private row(): HTMLElement { const row = document.createElement("div"); row.className = "chapter-study-row"; return row; }
  private button(text: string, action: () => void, label = text, disabled = false): HTMLButtonElement { const button = document.createElement("button"); button.type = "button"; button.textContent = text; button.disabled = disabled; button.setAttribute("aria-label", label); button.addEventListener("click", action); return button; }
}
