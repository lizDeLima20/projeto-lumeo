export abstract class BaseView {
  protected element: HTMLElement | null = null;

  public abstract render(): HTMLElement;

  public mount(container: HTMLElement): void {
    this.unmount();
    this.element = this.render();
    container.replaceChildren(this.element);
  }

  public unmount(): void {
    this.element?.remove();
    this.element = null;
  }

  protected createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
  ): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }
}
