import { ApiError } from "../services/ApiClient";
import { AuthManager } from "../services/AuthManager";
import { BaseView } from "./BaseView";

export class LoginView extends BaseView {
  public constructor(private readonly auth: AuthManager, private readonly onSuccess: () => void, private readonly onRegister: () => void) { super(); }
  public render(): HTMLElement {
    const section = this.createElement("section", "auth-page page-shell");
    const form = this.createElement("form", "auth-card");
    form.append(this.createElement("span", "eyebrow", "Sua biblioteca espera"), this.createElement("h1", "page-title", "Entrar"));
    const email = this.field("email", "E-mail", "email", !import.meta.env.DEV);
    const password = this.field("password", "Senha", "current-password", !import.meta.env.DEV);
    const error = this.createElement("p", "form-error"); error.setAttribute("role", "alert");
    const submit = this.createElement("button", "button button--primary", "Entrar"); submit.type = "submit";
    const register = this.createElement("button", "text-button", "Criar conta"); register.type = "button";
    register.addEventListener("click", this.onRegister);
    form.append(email.wrapper, password.wrapper, error, submit, register);
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); submit.disabled = true; error.textContent = "";
      try {
        const localDemo = import.meta.env.DEV && !email.input.value && !password.input.value;
        await this.auth.login(localDemo ? "local@lumeo.test" : email.input.value, localDemo ? "lumeo-local" : password.input.value);
        this.onSuccess();
      }
      catch (caught) { error.textContent = caught instanceof ApiError ? caught.message : "Não foi possível entrar."; }
      finally { submit.disabled = false; }
    });
    section.append(form); return section;
  }
  private field(type: string, label: string, autocomplete: string, required = true): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
    const wrapper = this.createElement("label", "field"); wrapper.append(this.createElement("span", "field__label", label));
    const input = this.createElement("input", "input") as HTMLInputElement;
    input.type = type; input.required = required; input.setAttribute("autocomplete", autocomplete);
    if (!required) input.placeholder = "Opcional no modo local";
    wrapper.append(input); return { wrapper, input };
  }
}
