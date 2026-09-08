import type { CloudImportProvider } from "./CloudImportProvider";
import type { ImportedFile } from "./BookImporter";
import { LocalFileImporter } from "./LocalFileImporter";
import type { AuthenticatedDriveDownloader } from "./UrlImporter";

export interface GoogleDriveConfig { clientId: string; apiKey: string; appId: string; }
export interface DriveSelection { id: string; name: string; mimeType: string; size?: number; }
export interface GoogleDriveGateway extends AuthenticatedDriveDownloader { selectFile(folderId?: string): Promise<DriveSelection | null>; }
export class PickerCancelledError extends Error {}
type GoogleWindow = Window & { google?: any; gapi?: any };

export class GoogleDriveImporter implements CloudImportProvider, AuthenticatedDriveDownloader {
  public readonly providerName = "Google Drive";
  private readonly gateway: GoogleDriveGateway;
  public constructor(private readonly config: GoogleDriveConfig, private readonly validator = new LocalFileImporter(), gateway?: GoogleDriveGateway) {
    this.gateway = gateway ?? new BrowserGoogleDriveGateway(config);
  }
  public async selectFile(folderId?: string, onProgress?: (percent: number | null) => void): Promise<ImportedFile> {
    this.assertConfigured(); const selected = await this.gateway.selectFile(folderId);
    if (!selected) throw new PickerCancelledError("Seleção do Google Drive cancelada.");
    return this.validator.import(await this.gateway.downloadFile(selected.id, onProgress), "google-drive");
  }
  public async downloadFile(fileId: string, onProgress?: (percent: number | null) => void): Promise<File> { this.assertConfigured(); return this.gateway.downloadFile(fileId, onProgress); }
  public get configured(): boolean { return Boolean(this.config.clientId && this.config.apiKey && this.config.appId); }
  private assertConfigured(): void { if (!this.configured) throw new Error("Configure as credenciais públicas do Google Drive para usar esta opção."); }
}

class BrowserGoogleDriveGateway implements GoogleDriveGateway {
  private token = "";
  public constructor(private readonly config: GoogleDriveConfig) {}
  public async selectFile(folderId?: string): Promise<DriveSelection | null> {
    await Promise.all([this.loadScript("https://accounts.google.com/gsi/client", "google"), this.loadScript("https://apis.google.com/js/api.js", "gapi")]);
    await this.authorize(); await this.loadPicker();
    return new Promise((resolve, reject) => {
      const host = window as GoogleWindow; const google = host.google; const view = new google.picker.DocsView().setIncludeFolders(false).setSelectFolderEnabled(false).setMimeTypes("application/pdf,application/epub+zip");
      if (folderId) view.setParent(folderId);
      const picker = new google.picker.PickerBuilder().setAppId(this.config.appId).setDeveloperKey(this.config.apiKey).setOAuthToken(this.token).addView(view)
        .setCallback((data: any) => { if (data.action === google.picker.Action.PICKED) { const doc = data.docs?.[0]; resolve(doc ? { id: doc.id, name: doc.name, mimeType: doc.mimeType, size: doc.sizeBytes } : null); }
          else if (data.action === google.picker.Action.CANCEL) resolve(null); else if (data.action === google.picker.Action.ERROR) reject(new Error("Não foi possível abrir o Google Drive. Tente novamente.")); }).build();
      picker.setVisible(true);
    });
  }
  public async downloadFile(fileId: string, onProgress?: (percent: number | null) => void): Promise<File> {
    if (!this.token) { await this.loadScript("https://accounts.google.com/gsi/client", "google"); await this.authorize(); }
    const metadata = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,mimeType,size`, "json") as { name: string; mimeType: string };
    const blob = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, "blob", onProgress) as Blob;
    return new File([blob], metadata.name, { type: metadata.mimeType || blob.type });
  }
  private authorize(): Promise<void> {
    const google = (window as GoogleWindow).google;
    return new Promise((resolve, reject) => { const client = google.accounts.oauth2.initTokenClient({ client_id: this.config.clientId,
      scope: "https://www.googleapis.com/auth/drive.file", prompt: "select_account",
      callback: (response: { access_token?: string; error?: string }) => response.access_token ? (this.token = response.access_token, resolve()) : reject(new Error(response.error === "access_denied" ? "Acesso ao Google Drive negado." : "Login Google cancelado.")),
      error_callback: () => reject(new Error("Login Google cancelado.")) }); client.requestAccessToken(); });
  }
  private loadPicker(): Promise<void> { return new Promise((resolve, reject) => (window as GoogleWindow).gapi.load("picker", { callback: resolve, onerror: () => reject(new Error("Não foi possível carregar o seletor do Google Drive.")) })); }
  private loadScript(src: string, globalName: "google" | "gapi"): Promise<void> {
    if ((window as GoogleWindow)[globalName]) return Promise.resolve();
    return new Promise((resolve, reject) => { const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`); const script = existing ?? document.createElement("script");
      script.addEventListener("load", () => resolve(), { once: true }); script.addEventListener("error", () => reject(new Error("Não foi possível carregar o acesso ao Google Drive.")), { once: true });
      if (!existing) { script.src = src; script.async = true; document.head.append(script); } });
  }
  private async request(url: string, kind: "json" | "blob", onProgress?: (percent: number | null) => void): Promise<object | Blob> {
    const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 45_000);
    try { const response = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` }, signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 404 ? "O arquivo não existe mais ou não está acessível." : response.status === 403 ? "O Google Drive negou acesso ao arquivo." : "Falha ao baixar o livro do Google Drive.");
      if (kind === "json") return response.json() as Promise<object>; const total = Number(response.headers.get("content-length")) || 0;
      if (!response.body) return response.blob(); const reader = response.body.getReader(); const chunks: BlobPart[] = []; let received = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; if (value) { chunks.push(new Uint8Array(value).buffer); received += value.byteLength; onProgress?.(total ? Math.round(received / total * 100) : null); } }
      return new Blob(chunks, { type: response.headers.get("content-type") ?? "" });
    } catch (error) { if (error instanceof DOMException && error.name === "AbortError") throw new Error("O download demorou demais. Tente novamente."); throw error; }
    finally { window.clearTimeout(timeout); }
  }
}
