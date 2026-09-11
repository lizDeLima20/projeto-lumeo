import { ApiError } from "../services/ApiClient";
import { AuthManager } from "../services/AuthManager";
import { BaseView } from "./BaseView";

export class RegisterView extends BaseView {
  public constructor(private readonly auth: AuthManager, private readonly onSuccess: () => void, private readonly onLogin: () => void) { super(); }
  public render(): HTMLElement {
    const section = this.createElement("section", "auth-page page-shell");
    const form = this.createElement("form", "auth-card");
    form.append(this.createElement("span", "eyebrow", this.t("ui.auth.startNow")), this.createElement("h1", "page-title", this.t("ui.auth.register")));
    const email = this.input(this.t("ui.auth.email"), "email", "email");
    const password = this.input(this.t("ui.auth.password"), "password", "new-password");
    const confirmation = this.input(this.t("ui.auth.confirmPassword"), "password", "new-password");
    const message = this.createElement("p", "form-error"); message.setAttribute("role", "alert");
    const submit = this.createElement("button", "button button--primary", this.t("ui.auth.register")); submit.type = "submit";
    const login = this.createElement("button", "text-button", this.t("ui.auth.haveAccount")); login.type = "button"; login.addEventListener("click", this.onLogin);
    form.append(email.wrapper, password.wrapper, confirmation.wrapper, message, submit, login);
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); message.textContent = "";
      if (password.input.value !== confirmation.input.value) { message.textContent = this.t("ui.auth.passwordMismatch"); return; }
      if (password.input.value.length < 8) { message.textContent = this.t("ui.auth.passwordMinimum"); return; }
      submit.disabled = true;
      try {
        const result = await this.auth.signup(email.input.value, password.input.value);
        if ("requiresEmailConfirmation" in result) message.textContent = this.t("ui.auth.confirmEmail");
        else this.onSuccess();
      } catch (caught) { message.textContent = caught instanceof ApiError ? caught.message : this.t("ui.auth.registerFailed"); }
      finally { submit.disabled = false; }
    });
    section.append(form); return section;
  }
  private input(label: string, type: string, autocomplete: string): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
    const wrapper = this.createElement("label", "field"); wrapper.append(this.createElement("span", "field__label", label));
    const input = this.createElement("input", "input") as HTMLInputElement;
    input.type = type; input.required = true; input.setAttribute("autocomplete", autocomplete); wrapper.append(input); return { wrapper, input };
  }
}
