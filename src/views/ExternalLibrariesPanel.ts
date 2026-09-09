import type { ExternalLibrarySource } from "../external/ExternalLibrarySource";
import type { OneDriveConnections } from "../external/OneDriveConnections";
import type { OneDriveFolder, OneDriveItem } from "../external/OneDriveFolderResolver";
import { OneDriveBrowserService } from "../external/OneDriveBrowserService";
import { OneDriveError } from "../external/OneDriveError";
import { I18nManager } from "../i18n/I18nManager";
import type { ExternalLibraryTranslationKey } from "../i18n/ExternalLibraryTranslations";
import { BaseView } from "./BaseView";

export class ExternalLibrariesPanel extends BaseView {
  private readonly i18n = I18nManager.shared;
  private root!: HTMLElement;
  private list!: HTMLElement;
  private content!: HTMLElement;
  private status!: HTMLElement;
  private controller: AbortController | null = null;
  private disposed = false;
  private stack: OneDriveFolder[] = [];
  public constructor(private readonly connections: OneDriveConnections,
    private readonly selectFile?: (driveId: string, item: OneDriveItem) => Promise<void>,
    private readonly openImport?: (sourceId: string) => void, private readonly initialSourceId?: string) { super(); }
  public render(): HTMLElement {
    this.disposed = false;
    this.root = this.createElement("section", "settings-card external-libraries");
    this.root.append(this.createElement("h2", "section-title", this.i18n.t("externalLibrary.title")));
    const toolbar = this.createElement("div", "form-actions");
    toolbar.append(this.button("externalLibrary.add", () => this.edit()));
    const connect = this.button("onedrive.connect", () => {
      this.status.textContent = this.i18n.t("onedrive.connecting"); connect.disabled = true;
      void this.connections.auth.connect().then(() => {
        if (!this.disposed) this.status.textContent = this.i18n.t("onedrive.connected");
      }).catch(error => this.showError(error)).finally(() => { connect.disabled = false; });
    });
    connect.disabled = true; toolbar.append(connect);
    this.status = this.createElement("p", "download-status"); this.status.setAttribute("role", "status");
    this.list = this.createElement("div", "external-source-list"); this.content = this.createElement("div", "external-source-content");
    this.root.append(toolbar, this.status, this.list, this.content);
    if (this.connections.config.enabled) {
      this.status.textContent = this.i18n.t("onedrive.initializing");
      void this.connections.auth.prepare().then(() => { if (!this.disposed) { connect.disabled = false; this.status.textContent = ""; } }).catch(error => this.showError(error));
    } else this.status.textContent = this.i18n.t("onedrive.notConfigured");
    void this.refresh().then(() => this.openInitial()).catch(error => this.showError(error));
    return this.root;
  }
  public override unmount(): void {
    this.disposed = true; this.controller?.abort();
    void this.connections.auth.dispose().catch(() => undefined); super.unmount();
  }
  private async openInitial(): Promise<void> {
    if (!this.initialSourceId || this.disposed) return;
    const source = (await this.connections.sources.all()).find(row => row.id === this.initialSourceId);
    if (source) await this.open(source);
  }
  private async refresh(): Promise<void> {
    const rows = await this.connections.sources.all(); if (this.disposed) return;
    this.list.replaceChildren();
    if (!rows.length) this.list.append(this.createElement("p", "page-subtitle", this.i18n.t("externalLibrary.empty")));
    rows.forEach(source => {
      const row = this.createElement("div", "external-source-row");
      row.append(this.createElement("strong", "", source.name), this.createElement("span", "eyebrow", "OneDrive"));
      row.append(this.button("externalLibrary.open", () => {
        if (this.openImport) this.openImport(source.id); else void this.open(source);
      }), this.button("externalLibrary.edit", () => this.edit(source)), this.button("externalLibrary.remove", () => {
        if (!confirm(this.i18n.t("externalLibrary.confirmRemove"))) return;
        this.controller?.abort(); this.content.replaceChildren();
        void this.connections.sources.remove(source.id).then(() => this.refresh()).catch(error => this.showError(error));
      })); this.list.append(row);
    });
    if (rows.length) this.list.append(this.button("externalLibrary.another", () => this.edit()));
  }
  private edit(source?: ExternalLibrarySource): void {
    this.controller?.abort(); this.content.replaceChildren();
    // This panel can live inside the existing import form, so do not nest forms.
    const fields = this.createElement("div", "external-source-editor");
    const name = this.field("externalLibrary.name", "text", source?.name ?? ""); name.input.maxLength = 100;
    const link = this.field("externalLibrary.link", "url", source?.sourceUrl ?? "");
    const save = this.button("externalLibrary.save", () => {
      if (!name.input.reportValidity() || !link.input.reportValidity()) return;
      save.disabled = true;
      void this.connections.sources.save(name.input.value, link.input.value, source?.id).then(() => {
        if (!this.disposed) fields.remove(); return this.refresh();
      }).catch(error => this.showError(error)).finally(() => { save.disabled = false; });
    });
    fields.append(name.label, link.label, save, this.button("externalLibrary.cancel", () => fields.remove()));
    this.content.append(fields); name.input.focus();
  }
  private async open(source: ExternalLibrarySource): Promise<void> {
    if (!this.connections.config.enabled) return this.showError(new OneDriveError("onedrive.notConfigured"));
    const controller = this.start(); this.status.textContent = this.i18n.t("onedrive.opening");
    try {
      const folder = await this.connections.folders.resolve(source.sourceUrl, controller.signal);
      if (!this.active(controller)) return;
      await this.connections.sources.resolved(source.id, `${folder.driveId}/${folder.id}`);
      this.stack = [folder]; await this.loadFolder(controller);
    } catch (error) { if (this.active(controller)) this.showError(error); }
  }
  private async loadFolder(controller: AbortController, nextLink?: string, existing?: HTMLElement): Promise<void> {
    const folder = this.stack.at(-1); if (!folder) return;
    try {
      const page = await this.connections.browser.list(folder, controller.signal, nextLink); if (!this.active(controller)) return;
      this.status.textContent = "";
      let rows = existing;
      if (!rows) {
        this.content.replaceChildren(this.createElement("h3", "section-title", folder.name));
        if (this.stack.length > 1) this.content.append(this.button("onedrive.back", () => { this.stack.pop(); void this.loadFolder(this.start()); }));
        rows = this.createElement("div", "external-file-list"); this.content.append(rows);
      }
      if (!page.items.length && !nextLink) rows.append(this.createElement("p", "", this.i18n.t("onedrive.empty")));
      page.items.forEach(item => {
        const row = this.createElement("div", "external-file-row");
        const label = item.folder ? this.i18n.t("onedrive.folder") : `${item.name.split(".").pop()?.toUpperCase()} · ${this.bytes(item.size)}`;
        row.append(this.createElement("span", "", item.folder ? "📁" : "▤"), this.createElement("strong", "", item.name), this.createElement("small", "", label));
        if (item.folder) row.append(this.button("externalLibrary.open", () => {
          this.stack.push({ id: item.id, driveId: item.parentReference?.driveId ?? folder.driveId, name: item.name }); void this.loadFolder(this.start());
        }));
        else if (OneDriveBrowserService.supported(item)) row.append(this.button("import.remote.add", () => { void this.selectFile?.(folder.driveId, item).catch(error => this.showError(error)); }));
        else row.append(this.createElement("span", "", this.i18n.t("onedrive.limaUnavailable")));
        rows!.append(row);
      });
      if (page.nextLink) {
        const next = this.button("onedrive.more", () => { next.remove(); void this.loadFolder(controller, page.nextLink, rows); }); rows.append(next);
      }
    } catch (error) { if (this.active(controller)) this.showError(error); }
  }
  private start(): AbortController { this.controller?.abort(); this.controller = new AbortController(); return this.controller; }
  private active(controller: AbortController): boolean { return !this.disposed && !controller.signal.aborted && this.controller === controller; }
  private showError(error: unknown): void {
    if (this.disposed) return;
    this.status.textContent = error instanceof OneDriveError ? error.message : this.i18n.t("externalLibrary.storageFailed");
  }
  private button(key: ExternalLibraryTranslationKey, action: () => void): HTMLButtonElement {
    const button = this.createElement("button", "button button--secondary", this.i18n.t(key)); button.type = "button"; button.addEventListener("click", action); return button;
  }
  private field(key: ExternalLibraryTranslationKey, type: string, value: string): { label: HTMLLabelElement; input: HTMLInputElement } {
    const label = this.createElement("label", "field"), input = this.createElement("input", "input"); input.type = type; input.value = value;
    label.append(this.createElement("span", "field__label", this.i18n.t(key)), input); return { label, input };
  }
  private bytes(size: number): string { return `${(size / (1024 * 1024)).toLocaleString(this.i18n.locale, { maximumFractionDigits: 1 })} MB`; }
}
