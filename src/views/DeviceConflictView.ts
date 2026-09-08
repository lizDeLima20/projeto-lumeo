import { AppState } from "../core/AppState";
import { ApiError } from "../services/ApiClient";
import { AuthManager } from "../services/AuthManager";
import { DeviceManager } from "../services/DeviceManager";
import { BaseView } from "./BaseView";

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
    card.append(label, error, replace, cancel);
    card.addEventListener("submit", async (event) => {
      event.preventDefault(); replace.disabled = true;
      try { await this.auth.reauthenticate(password.value); await this.devices.replace(); this.onResolved(); }
      catch (caught) { error.textContent = caught instanceof ApiError ? caught.message : "Não foi possível substituir o aparelho."; }
      finally { replace.disabled = false; }
    });
    section.append(card); return section;
  }
}
