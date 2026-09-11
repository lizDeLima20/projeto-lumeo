import { AppState } from "../core/AppState";
import { BaseView } from "./BaseView";
import { StoragePersistenceService } from "../services/StoragePersistenceService";
import { DesktopLibraryFolderService } from "../services/DesktopLibraryFolderService";
import { I18nManager, type SupportedLocale } from "../i18n/I18nManager";
import { LocalStorageManager } from "../storage/LocalStorageManager";
import { DiagnosticExporter } from "../diagnostics/DiagnosticExporter";
import { AppVersionManager } from "../pwa/AppVersionManager";
import { ExternalLibrariesPanel } from "./ExternalLibrariesPanel";
import type { OneDriveConnections } from "../external/OneDriveConnections";
import type { PwaInstallManager } from "../pwa/PwaInstallManager";

export class SettingsView extends BaseView {
  private externalPanel: ExternalLibrariesPanel | null = null;
  private readonly i18n = I18nManager.shared;
  public constructor(private readonly state: AppState, private readonly onThemeChange: (theme: "light" | "dark") => void, private readonly persistence?: StoragePersistenceService, private readonly folder?: DesktopLibraryFolderService,
    private readonly oneDrive?: { connections: OneDriveConnections; open(sourceId: string): void }, private readonly install?: PwaInstallManager) { super(); }
  private stopInstallWatch: (() => void) | null = null;
  public override unmount(): void { this.stopInstallWatch?.(); this.stopInstallWatch = null; this.externalPanel?.unmount(); this.externalPanel = null; super.unmount(); }
  public render(): HTMLElement {
    const section = this.createElement("section", "page-shell settings");
    section.append(this.createElement("span", "eyebrow", this.i18n.t("ui.settings.preferences")), this.createElement("h1", "page-title", this.i18n.t("ui.settings.title")));
    const card = this.createElement("div", "settings-card"); card.append(this.createElement("h2", "section-title", this.i18n.t("ui.settings.appearance")),
      this.createElement("p", "page-subtitle", this.i18n.t("ui.settings.appearanceHelp")));
    const choices = this.createElement("div", "theme-options");
    ([['light', '☀', this.i18n.t("ui.settings.lightTheme")], ['dark', '☾', this.i18n.t("ui.settings.darkTheme")]] as const).forEach(([theme, icon, label]) => {
      const button = this.createElement("button", `theme-choice${this.state.settings.theme === theme ? " theme-choice--active" : ""}`);
      button.type = "button"; button.append(this.createElement("span", "theme-choice__icon", icon), this.createElement("strong", undefined, label));
      button.addEventListener("click", () => { this.onThemeChange(theme); choices.querySelectorAll(".theme-choice").forEach((item) => item.classList.toggle("theme-choice--active", item === button)); }); choices.append(button);
    }); card.append(choices); section.append(card, this.installCard(), this.languageCard(), this.storageCard());
    if (this.oneDrive) { this.externalPanel = new ExternalLibrariesPanel(this.oneDrive.connections, undefined, this.oneDrive.open); section.append(this.externalPanel.render()); }
    return section;
  }
  /** Installing is always reachable from here: the button when the browser offers it, the
   *  Share-sheet steps on iPhone and iPad, and a plain confirmation once installed. */
  private installCard(): HTMLElement {
    const card = this.createElement("div", "settings-card settings-install");
    const title = this.createElement("h2", "section-title", this.i18n.t("ui.pwa.installLumeo")), text = this.createElement("p", "page-subtitle");
    const button = this.createElement("button", "button button--primary", this.i18n.t("ui.pwa.installApp")) as HTMLButtonElement; button.type = "button";
    card.append(title, text, button);
    const paint = (): void => {
      const install = this.install;
      button.hidden = !install?.available;
      if (install?.installed) text.textContent = this.i18n.t("ui.pwa.installed");
      else if (install?.available) text.textContent = this.i18n.t("ui.pwa.installDescription");
      else if (install?.needsManualSteps) text.textContent = this.i18n.t("ui.pwa.safariInstall");
      else text.textContent = this.i18n.t("ui.pwa.browserInstall");
    };
    button.addEventListener("click", () => { button.disabled = true; void this.install?.install().then((outcome) => {
      if (outcome === "accepted") text.textContent = this.i18n.t("ui.pwa.installing"); else paint();
    }).finally(() => { button.disabled = false; }); });
    this.stopInstallWatch = this.install?.onChange(paint) ?? null;
    paint();
    return card;
  }
  private languageCard(): HTMLElement { const card=this.createElement("div","settings-card"),title=this.createElement("h2","section-title",this.i18n.t("settings.language")),help=this.createElement("p","page-subtitle",this.i18n.t("settings.languageHelp")),label=this.createElement("label","reader-setting-field");const select=this.createElement("select","input") as HTMLSelectElement;select.setAttribute("aria-label",this.i18n.t("settings.language"));this.i18n.options().forEach(option=>select.append(new Option(option.label,option.value)));select.value=this.i18n.locale;select.addEventListener("change",()=>void this.i18n.setLocale(select.value as SupportedLocale));label.append(this.createElement("span","field__label",this.i18n.t("settings.language")),select);card.append(title,help,label);return card;}
  private storageCard(): HTMLElement { const card=this.createElement("div","settings-card"),title=this.createElement("h2","section-title",this.i18n.t("storage.title")),status=this.createElement("p","page-subtitle",this.i18n.t("storage.checking")),details=this.createElement("ul","storage-breakdown");card.append(title,status,details);const manager=new LocalStorageManager();void Promise.all([this.persistence?.status(),manager.report(this.state.books)]).then(([persistence,report])=>{const used=report.usage===undefined?"indisponível":this.bytes(report.usage),available=report.available===undefined?"indisponível":this.bytes(report.available);status.textContent=`${persistence?.persistent?this.i18n.t("storage.persistent"):this.i18n.t("storage.local")} · ${this.state.books.length} livros`;details.replaceChildren(this.storageLine("storage.used",used),this.storageLine("storage.available",available),this.storageLine("storage.books",this.bytes(report.categories.books)),this.storageLine("storage.cache",this.bytes(report.categories.cache)),this.storageLine("storage.study",this.bytes(report.categories.studyData)));if(report.lowSpace)details.append(this.createElement("li","storage-breakdown__warning",this.i18n.t("storage.lowSpace")));});const clear=this.createElement("button","button button--secondary",this.i18n.t("storage.clearTemporary"));clear.type="button";clear.addEventListener("click",()=>void manager.cleanupTemporary().then(()=>{status.textContent=this.i18n.t("storage.temporaryCleared");}));card.append(clear);const diagnostic=this.createElement("button","button button--secondary",this.i18n.t("diagnostics.copy"));diagnostic.type="button";diagnostic.addEventListener("click",()=>void this.copyDiagnostic());card.append(this.createElement("h2","section-title",this.i18n.t("diagnostics.title")),diagnostic);if(this.folder?.supported){const choose=this.createElement("button","button button--secondary","Escolher pasta da biblioteca");choose.type="button";choose.addEventListener("click",()=>void this.folder?.choose().then(()=>{status.textContent="Pasta da biblioteca autorizada.";}).catch(()=>{status.textContent="A seleção da pasta foi cancelada.";}));card.append(choose);void this.folder.stored().then(handle=>{if(!handle)return;const authorize=this.createElement("button","button button--secondary","Autorizar pasta");authorize.type="button";authorize.addEventListener("click",()=>void this.folder?.permission(true).then(permission=>{status.textContent=permission==="granted"?"Pasta da biblioteca autorizada.":"A biblioteca está nesta pasta. Autorize o acesso para continuar.";}));card.append(authorize);});}return card;}
  private storageLine(key:"storage.used"|"storage.available"|"storage.books"|"storage.cache"|"storage.study",value:string):HTMLLIElement{const item=this.createElement("li","storage-breakdown__item") as HTMLLIElement;item.textContent=`${this.i18n.t(key)}: ${value}`;return item;}
  private async copyDiagnostic():Promise<void>{const storage=await new LocalStorageManager().report(this.state.books),diagnostic=new DiagnosticExporter().export({versions:new AppVersionManager().info(),connectivity:navigator.onLine?"ONLINE":"OFFLINE",storage,persistent:(await this.persistence?.status())?.persistent??false});await navigator.clipboard?.writeText(diagnostic);}
  private bytes(value:number):string{return this.i18n.formatter.fileSize(value,this.i18n.locale);}
}
