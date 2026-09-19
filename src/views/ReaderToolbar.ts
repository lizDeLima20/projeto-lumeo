import { I18nManager } from "../i18n/I18nManager";
import { BaseView } from "./BaseView";

export interface ReaderToolbarActions {
  back(): void; previous(): void; next(): void; pagePicker(): void; toggleSettings(): void;
  zoomIn(): void; zoomOut(): void; fitWidth(): void; fitPage(): void; bookmark(): void; toggleStudy(): void; toggleNavigation():void; toggleNotebook():void;
}

export class ReaderToolbar extends BaseView {
  private pageIndicator: HTMLButtonElement | null = null;
  private zoomIndicator: HTMLElement | null = null;
  private previousButton: HTMLButtonElement | null = null;
  private nextButton: HTMLButtonElement | null = null;
  private settingsButton: HTMLButtonElement | null = null;
  private chapterLabel:HTMLElement|null=null;
  private readonly i18n=I18nManager.shared;

  public constructor(private readonly title: string, private readonly actions: ReaderToolbarActions) { super(); }
  public render(): HTMLElement {
    const wrapper = this.createElement("div", "reader-controls");
    const backButton = this.button("‹", this.i18n.t("reader.back"), this.actions.back, "reader-back-fab");
    // One discreet icon, not a row of them: everything else about a book's marks lives one
    // tap away inside "Abrir marcações" (Caderno), not scattered across the reader chrome.
    const marksButton = this.button("📑", this.i18n.t("reader.study"), this.actions.toggleNotebook, "reader-marks-fab");
    this.settingsButton = this.button("⚙", this.i18n.t("reader.settings"), this.actions.toggleSettings, "reader-settings-fab");
    this.settingsButton.setAttribute("aria-expanded", "false"); this.settingsButton.setAttribute("aria-controls", "reader-settings");
    this.settingsButton.title=this.title;
    wrapper.append(backButton, marksButton, this.settingsButton); return wrapper;
  }
  public update(currentPage: number, totalPages: number, zoom: number): void {
    if (this.pageIndicator) this.pageIndicator.textContent = `${currentPage} / ${totalPages}`;
    if (this.zoomIndicator) this.zoomIndicator.textContent = `${zoom}%`;
    if (this.previousButton) this.previousButton.disabled = currentPage <= 1;
    if (this.nextButton) this.nextButton.disabled = currentPage >= totalPages;
  }
  public setSettingsOpen(open: boolean): void { this.settingsButton?.setAttribute("aria-expanded", String(open)); }
  public setChapter(title:string):void{if(this.chapterLabel)this.chapterLabel.textContent=title;}
  private button(label: string, ariaLabel: string, action: () => void, className = "reader-control-button"): HTMLButtonElement {
    const button = this.createElement("button", className, label); button.type = "button"; button.setAttribute("aria-label", ariaLabel); button.addEventListener("click", action); return button;
  }
}
