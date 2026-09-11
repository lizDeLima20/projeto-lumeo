import { I18nManager, type TranslationKey } from "../i18n/I18nManager";
import { GoogleDriveLibraryRepository, type GoogleDriveLibrarySource } from "../external/GoogleDriveLibraryRepository";
import { GoogleDriveLibraryService, type GoogleLibraryFile } from "../external/GoogleDriveLibraryService";
import { BookDownloadError, StartTelemetry } from "../diagnostics/StartTelemetry";

export class GoogleDriveLibrariesModal {
  private dialog: HTMLDialogElement | null = null;
  private body!: HTMLElement; private status!: HTMLElement;
  private controller: AbortController | null = null;
  private generation = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  public constructor(private readonly sources: GoogleDriveLibraryRepository, private readonly service: GoogleDriveLibraryService,
    private readonly importFile: (file: File) => Promise<void>) {}
  private t(key: TranslationKey): string { return I18nManager.shared.t(key); }
  private button(key: TranslationKey, action: () => void, text?: string): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.className = "button button--secondary";
    button.textContent = text ?? this.t(key); button.setAttribute("aria-label", this.t(key)); button.onclick = action; return button;
  }
  public open(): void {
    if (this.dialog?.open) return;
    const dialog = document.createElement("dialog"); this.dialog = dialog; dialog.className = "google-libraries-modal";
    dialog.setAttribute("aria-label", this.t("google.title"));
    const heading = document.createElement("h2"); heading.textContent = this.t("google.title");
    const header = document.createElement("div"); header.className = "google-library-toolbar";
    header.append(heading, this.button("google.close", () => this.close(), "×"));
    this.body = document.createElement("div"); this.status = document.createElement("p"); this.status.setAttribute("role", "status");
    dialog.append(header, this.status, this.body); dialog.addEventListener("cancel", event => { event.preventDefault(); this.close(); });
    document.body.append(dialog); dialog.showModal(); void this.showSources();
  }
  public close(): void {
    this.generation++; this.controller?.abort(); this.timers.forEach(clearTimeout); this.timers.clear();
    this.dialog?.close(); this.dialog?.remove(); this.dialog = null;
  }
  public dispose(): void { this.close(); this.service.dispose(); }
  private report(error: unknown): void {
    if (!this.dialog) return;
    this.status.textContent = error instanceof Error && !(error instanceof DOMException) ? error.message : this.t("google.failed");
  }
  private async showSources(): Promise<void> {
    const generation = ++this.generation; this.controller?.abort(); this.status.textContent = "";
    try {
      const sources = await this.sources.all(); if (!this.dialog || generation !== this.generation) return;
      this.body.replaceChildren();
      if (!sources.length) { this.edit(); return; }
      for (const source of sources) {
        const row = document.createElement("div"); row.className = "google-library-row";
        let pressed = false; let timer: ReturnType<typeof setTimeout> | undefined; let x = 0, y = 0;
        const item = this.button("google.title", () => { if (pressed) { pressed = false; return; } void this.openSource(source); }, `📘 ${source.name}`);
        item.setAttribute("aria-label", source.name);
        const cancel = (): void => { if (timer) { clearTimeout(timer); this.timers.delete(timer); timer = undefined; } };
        item.addEventListener("pointerdown", event => { if (event.button !== 0) return; pressed = false; x = event.clientX; y = event.clientY;
          timer = setTimeout(() => { pressed = true; this.options(source, row); cancel(); }, 550); this.timers.add(timer); });
        item.addEventListener("pointermove", event => { if (Math.hypot(event.clientX - x, event.clientY - y) > 10) cancel(); });
        ["pointerup", "pointercancel", "pointerleave"].forEach(type => item.addEventListener(type, cancel));
        item.addEventListener("contextmenu", event => { event.preventDefault(); cancel(); this.options(source, row); });
        row.append(item, this.button("google.options", () => this.options(source, row), "⋯")); this.body.append(row);
      }
      const add = this.button("google.add", () => this.edit(), "+"); add.classList.add("google-library-add"); this.body.append(add);
    } catch (error) { this.report(error); }
  }
  private options(source: GoogleDriveLibrarySource, row: HTMLElement): void {
    this.body.querySelectorAll(".google-library-menu").forEach(menu => menu.remove());
    const menu = document.createElement("div"); menu.className = "google-library-menu";
    menu.append(this.button("google.rename", () => this.edit(source)), this.button("google.changeLink", () => this.edit(source, true)),
      this.button("google.delete", () => {
        if (!confirm(this.t("google.deleteConfirm"))) return;
        void this.sources.remove(source.id).then(() => this.showSources()).catch(error => this.report(error));
      })); row.append(menu);
  }
  private edit(source?: GoogleDriveLibrarySource, focusLink = false): void {
    this.controller?.abort(); this.body.replaceChildren(); this.status.textContent = "";
    const form = document.createElement("form"); form.className = "google-library-editor";
    const field = (key: TranslationKey, value: string): HTMLInputElement => {
      const label = document.createElement("label"); label.textContent = this.t(key);
      const input = document.createElement("input"); input.className = "input"; input.value = value; input.required = true;
      label.append(input); form.append(label); return input;
    };
    const name = field("google.name", source?.name ?? ""); name.maxLength = 100;
    const link = field("google.link", source?.folderUrl ?? ""); link.type = "url";
    const save = this.button("externalLibrary.save", () => undefined); save.type = "submit";
    form.append(this.button("externalLibrary.cancel", () => { if (source) void this.showSources(); else this.close(); }), save);
    form.addEventListener("submit", event => { event.preventDefault(); save.disabled = true;
      void this.sources.save(name.value, link.value, source?.id).then(() => this.showSources()).catch(error => this.report(error)).finally(() => { save.disabled = false; }); });
    this.body.append(form); (focusLink ? link : name).focus();
  }
  private async openSource(source: GoogleDriveLibrarySource): Promise<void> {
    this.controller?.abort(); const generation = ++this.generation;
    this.status.textContent = "";
    if (!this.service.configured) { this.report(new Error(this.t("google.notConfigured"))); return; }
    const open = (): void => { void this.folder(source.folderId, new URL(source.folderUrl).searchParams.get("resourcekey") ?? undefined); };
    if (this.service.authorized) { open(); return; }
    this.status.textContent = this.t("google.loading");
    try {
      await this.service.prepare(); if (!this.dialog || generation !== this.generation) return;
      this.body.replaceChildren(); this.status.textContent = "";
      const connect = this.button("google.connect", () => { connect.disabled = true;
        void this.service.connect().then(() => { if (this.dialog && generation === this.generation) open(); }).catch(error => this.report(error)).finally(() => { connect.disabled = false; }); });
      this.body.append(connect, this.button("google.back", () => void this.showSources()));
    } catch (error) { this.report(error); }
  }
  private async folder(id: string, key?: string, pageToken?: string): Promise<void> {
    this.controller?.abort(); const controller = new AbortController(); this.controller = controller;
    this.status.textContent = this.t("google.loading");
    try {
      const page = await this.service.list(id, key, controller.signal, pageToken); if (controller.signal.aborted || !this.dialog) return;
      this.body.replaceChildren(this.button("google.back", () => void this.showSources()));
      this.status.textContent = page.files.length ? "" : this.t("google.empty");
      for (const file of page.files) {
        const isFolder = file.mimeType === GoogleDriveLibraryService.FOLDER;
        const item = this.button("import.remote.add", () => { if (isFolder) void this.folder(file.id, file.resourceKey); else void this.download(file); },
          `${isFolder ? "📁" : "📘"} ${file.name}${file.size ? ` · ${(Number(file.size) / 1048576).toFixed(1)} MB` : ""}`);
        item.setAttribute("aria-label", file.name); item.classList.add("google-library-file");
        if (/\.lima$/i.test(file.name)) { item.disabled = true; item.textContent += ` — ${this.t("google.lima")}`; }
        this.body.append(item);
      }
      if (page.nextPageToken) this.body.append(this.button("google.more", () => void this.folder(id, key, page.nextPageToken)));
    } catch (error) { if (!controller.signal.aborted) this.report(error); }
  }
  private async download(file: GoogleLibraryFile): Promise<void> {
    this.controller?.abort(); const controller = new AbortController(); this.controller = controller;
    this.body.replaceChildren(this.button("import.download.cancel", () => { controller.abort(); void this.showSources(); }));
    this.status.textContent = this.t("import.download.loading");
    try {
      const downloaded = await this.service.download(file, controller.signal, percent => {
        if (!controller.signal.aborted) this.status.textContent = `${this.t("import.download.loading")}${percent === null ? "" : ` ${percent}%`}`;
      });
      if (!this.dialog || controller.signal.aborted) return;
      StartTelemetry.request(file.id, undefined, "VALIDATING");
      await this.importFile(downloaded); this.close();
    } catch (error) {
      if (!controller.signal.aborted) {
        const typed = error instanceof BookDownloadError ? error : new BookDownloadError("EPUB_INVALID", "VALIDATING", file.id, undefined, false, error);
        if (!(error instanceof BookDownloadError)) StartTelemetry.failed(file.id, undefined, "VALIDATING", error);
        this.report(typed);
        if (typed.retryable) this.body.append(this.button("import.download.retry", () => void this.download(file)));
        this.body.append(this.button("google.back", () => void this.showSources()));
      }
    }
  }
}
