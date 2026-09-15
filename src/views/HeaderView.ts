import type { RouteName } from "../core/Router";
import { AUTHENTICATED_NAVIGATION, type NavigationItem } from "../navigation/NavigationItem";
import { BaseView } from "./BaseView";
import { HamburgerButton } from "./HamburgerButton";
import { MobileNavigationDrawer } from "./MobileNavigationDrawer";
import { I18nManager } from "../i18n/I18nManager";

export class HeaderView extends BaseView {
  private readonly i18n = I18nManager.shared;
  private readonly hamburger = new HamburgerButton();
  private drawer: MobileNavigationDrawer | null = null;

  public constructor(private readonly onNavigate: (route: RouteName) => void, private readonly authenticated: boolean,
    private readonly userName: string, private readonly onLogout: () => void) { super(); }

  public render(): HTMLElement {
    const wrapper = this.createElement("div", "header__inner");
    const brand = this.createElement("button", "brand"); brand.type = "button"; brand.setAttribute("aria-label", this.i18n.t("ui.navigate.home"));
    const mark = this.createElement("img", "brand__logo") as HTMLImageElement;
    mark.src = "/icons/lumeo-logo.png"; mark.alt = ""; mark.width = 46; mark.height = 46;
    const identity=this.createElement("span","brand__identity");identity.append(this.createElement("span", "brand__name", "Lumeo"),this.createElement("small","brand__tagline",this.i18n.t("ui.brand.tagline")));
    brand.append(mark, identity); brand.addEventListener("click", () => this.onNavigate("home"));

    const desktopNav = this.createElement("nav", "header__nav header__nav--desktop"); desktopNav.setAttribute("aria-label", this.i18n.t("ui.navigation.main"));
    const items = this.authenticated ? AUTHENTICATED_NAVIGATION : [];
    items.forEach((item) => desktopNav.append(this.navigationButton(item)));
    wrapper.append(brand, desktopNav);

    if (this.authenticated) {
      const hamburger = this.hamburger.render(); hamburger.addEventListener("click", () => this.drawer?.toggle()); wrapper.append(hamburger);
      this.drawer = new MobileNavigationDrawer(items, this.userName, this.onNavigate, this.onLogout, (open) => this.hamburger.setOpen(open));
      // The header uses backdrop-filter, which creates a containing block for
      // fixed descendants. Mounting the drawer at body level keeps it between
      // the header and mobile bottom navigation instead of clipping its links.
      this.drawer.mount(document.body);
    }
    return wrapper;
  }

  public override unmount(): void { this.drawer?.unmount(); this.drawer = null; super.unmount(); }

  private navigationButton(item: NavigationItem): HTMLButtonElement {
    const button = this.createElement("button", `nav-link${item.primary ? " nav-link--primary" : ""}`, this.i18n.t(item.labelKey));
    button.type = "button"; button.addEventListener("click", () => item.route ? this.onNavigate(item.route) : this.onLogout()); return button;
  }
}
