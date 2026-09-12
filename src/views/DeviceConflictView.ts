import { AppState } from "../core/AppState";
import { ApiError } from "../services/ApiClient";
import { AuthManager } from "../services/AuthManager";
import { DeviceManager } from "../services/DeviceManager";
import { BaseView } from "./BaseView";
import { GoogleAuthButton } from "./GoogleAuthButton";

export class DeviceConflictView extends BaseView {
  public constructor(private readonly state: AppState, private readonly auth: AuthManager, private readonly devices: DeviceManager,
    private readonly onResolved: () => void, private readonly onCancel: () => void) { super(); }
  public render(): HTMLElement {
    const section = this.createElement("section", "auth-page page-shell");
    const card = this.createElement("form", "auth-card");
    card.append(this.createElement("span", "eyebrow", "Verificação de segurança"),
      this.createElement("h1", "page-title", "Dispositivo já vinculado"),
      this.createElement("p", "page-subtitle", "Esta conta já está vinculada a outro dispositivo."));
    if (this.state.conflictingDevice) {
      card.append(this.createElement("p", "device-detail", `${this.state.conflictingDevice.deviceName} · último acesso ${new Date(this.state.conflictingDevice.lastSeenAt).toLocaleString("pt-BR")}`));
    }
    const label = this.createElement("label", "field"); label.append(this.createElement("span", "field__label", "Confirme sua senha"));
    const password = this.createElement("input", "input") as HTMLInputElement; password.type = "password"; password.required = true; password.autocomplete = "current-password"; label.append(password);
    const error = this.createElement("p", "form-error"); error.setAttribute("role", "alert");
    const replace = this.createElement("button", "button button--primary", "Usar este aparelho"); replace.type = "submit";
    const cancel = this.createElement("button", "button button--secondary", "Cancelar"); cancel.type = "button"; cancel.addEventListener("click", this.onCancel);
    /* A Google account has no password to confirm, so it confirms with Google instead. The
       e-mail must be the one already signed in: confirming with a different Google account
       would otherwise replace the device of the wrong account. */
    const google = new GoogleAuthButton("continue_with", async (credential, nonce) => {
      error.textContent = "";
      const expected = this.state.currentUser?.email?.trim().toLowerCase();
      await this.auth.loginWithGoogle(credential, nonce);
      if (expected && this.state.currentUser?.email?.trim().toLowerCase() !== expected) {
        await this.auth.logout();
        throw new Error(this.t("ui.device.googleAccountMismatch"));
      }
      await this.devices.replace(); this.onResolved();
    }, (message) => { error.textContent = message; }).render();
    card.append(label, error, replace, google, cancel);
    card.addEventListener("submit", async (event) => {
      event.preventDefault(); replace.disabled = true;
      try { await this.auth.reauthenticate(password.value); await this.devices.replace(); this.onResolved(); }
      catch (caught) { error.textContent = caught instanceof ApiError ? caught.message : "Não foi possível substituir o aparelho."; }
      finally { replace.disabled = false; }
    });
    section.append(card); return section;
  }
}
