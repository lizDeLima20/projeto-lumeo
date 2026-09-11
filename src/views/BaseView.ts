import { I18nManager } from "../i18n/I18nManager";
import type { TranslationKey } from "../i18n/I18nManager";

export abstract class BaseView {
  protected element: HTMLElement | null = null;

  public abstract render(): HTMLElement;

  public mount(container: HTMLElement): void {
    this.unmount();
    this.element = this.render();
    // Older views are progressively migrated to explicit keys. This bridge
    // keeps their reviewed legacy labels localized during that migration.
    I18nManager.shared.localizeTree(this.element);
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

  protected t(key: TranslationKey, parameters?: Readonly<Record<string, string | number>>): string {
    return I18nManager.shared.t(key, parameters);
  }
}
