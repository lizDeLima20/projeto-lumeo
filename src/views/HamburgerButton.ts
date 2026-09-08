export class HamburgerButton {
  private button: HTMLButtonElement | null = null;

  public render(): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "hamburger-button";
    button.type = "button";
    button.setAttribute("aria-label", "Abrir menu");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "mobile-navigation-drawer");
    for (let index = 0; index < 3; index += 1) {
      const line = document.createElement("span");
      line.className = "hamburger-button__line";
      button.append(line);
    }
    this.button = button;
    return button;
  }

  public setOpen(open: boolean): void {
    if (!this.button) return;
    this.button.classList.toggle("hamburger-button--open", open);
    this.button.setAttribute("aria-expanded", String(open));
    this.button.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
  }

  public focus(): void { this.button?.focus(); }
}
