import { BaseView } from "./BaseView";

/**
 * "Audiobooks" today is only the route, the menu entry and this screen - no catalogue, no
 * files, no Google Drive, no streaming. It exists so the entry point is real and the future
 * feature has somewhere to grow into without a routing change.
 */
export class AudiobooksView extends BaseView {
  public constructor(private readonly onBack: () => void) { super(); }
  public render(): HTMLElement {
    const section = this.createElement("section", "page-shell audiobooks-view");
    const back = this.createElement("button", "link-button", this.t("ui.common.back"));
    back.type = "button"; back.addEventListener("click", this.onBack);
    const badge = this.createElement("span", "audiobooks-view__badge", "🎧");
    badge.setAttribute("aria-hidden", "true");
    section.append(back, badge,
      this.createElement("span", "eyebrow", this.t("ui.audiobooks.eyebrow")),
      this.createElement("h1", "page-title", this.t("ui.audiobooks.title")),
      this.createElement("p", "page-subtitle", this.t("ui.audiobooks.description")));
    return section;
  }
}
