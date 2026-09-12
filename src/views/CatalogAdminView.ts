import { CatalogService, type CatalogSyncReport } from "../services/CatalogService";
import { BaseView } from "./BaseView";

/** Route is deliberately not in normal navigation; backend role still decides access. */
export class CatalogAdminView extends BaseView {
  public constructor(private readonly catalog: CatalogService, private readonly onBack: () => void) { super(); }
  public render(): HTMLElement {
    const section = this.createElement("section", "catalog-admin page-shell"); const status = this.createElement("p", "catalog__status", this.t("ui.common.loading")); section.append(status); void this.load(section, status); return section;
  }
  private async load(section: HTMLElement, status: HTMLElement): Promise<void> {
    try {
      const access = await this.catalog.adminStatus(); if (!access.isAdmin) { status.textContent = this.t("ui.catalog.adminDenied"); return; }
      status.remove(); const title = this.createElement("h1", "page-title", this.t("ui.catalog.adminTitle")); const note = this.createElement("p", "page-subtitle", this.t("ui.catalog.adminHelp"));
      const sync = this.createElement("button", "button button--primary", this.t("ui.catalog.sync")); sync.type = "button"; const result = this.createElement("p", "catalog__status"); result.setAttribute("role", "status");
      const back = this.createElement("button", "link-button", this.t("ui.common.back")); back.type = "button"; back.addEventListener("click", this.onBack);
      sync.addEventListener("click", () => void this.sync(sync, result)); section.append(back, title, note, sync, result);
    } catch (error) { status.textContent = error instanceof Error ? error.message : this.t("ui.catalog.adminDenied"); }
  }
  private async sync(button: HTMLButtonElement, result: HTMLElement): Promise<void> {
    button.disabled = true; result.textContent = this.t("ui.catalog.syncing");
    try { const report = await this.catalog.sync(); result.textContent = this.report(report); }
    catch (error) { result.textContent = error instanceof Error ? error.message : this.t("ui.catalog.failed"); }
    finally { button.disabled = false; }
  }
  private report(value: CatalogSyncReport): string { return this.t("ui.catalog.syncResult", { total: value.total, created: value.created, updated: value.updated, duplicates: value.duplicates, failures: value.failures }); }
}
