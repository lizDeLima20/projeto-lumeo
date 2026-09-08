import type { RouteName } from "../core/Router";
import type { NavigationItem } from "../navigation/NavigationItem";

export class MobileNavigationDrawer {
  public static readonly motionDuration = 300;
  public static readonly hasOwnBackground = true;
  public static readonly hasOverlay = true;
  private root: HTMLElement | null = null;
  private drawer: HTMLElement | null = null;
  private openState = false;
  private returnFocusTo: HTMLElement | null = null;

  public constructor(private readonly items: readonly NavigationItem[], private readonly userName: string,
    private readonly onNavigate: (route: RouteName) => void, private readonly onLogout: () => void,
    private readonly onStateChange: (open: boolean) => void) {}

  public render(): HTMLElement {
    const root = document.createElement("div"); root.className = "mobile-navigation";
    const overlay = document.createElement("button"); overlay.className = "drawer-overlay"; overlay.type = "button";
    overlay.setAttribute("aria-label", "Fechar menu"); overlay.tabIndex = -1; overlay.addEventListener("click", () => this.close());
    const drawer = document.createElement("aside"); drawer.className = "navigation-drawer"; drawer.id = "mobile-navigation-drawer";
    drawer.setAttribute("aria-label", "Menu principal"); drawer.setAttribute("aria-hidden", "true"); drawer.setAttribute("role", "navigation");
    const profile = document.createElement("div"); profile.className = "drawer-profile";
    const avatar = document.createElement("img"); avatar.className = "drawer-avatar"; avatar.src = "/icons/lumeo-logo.png"; avatar.alt = ""; avatar.width = 64; avatar.height = 64;
    const greeting = document.createElement("div");
    const hello = document.createElement("strong"); hello.textContent = `Olá, ${this.userName}!`;
    const wish = document.createElement("span"); wish.textContent = "Boa leitura"; greeting.append(hello, wish); profile.append(avatar, greeting);
    const nav = document.createElement("nav"); nav.className = "drawer-links"; nav.setAttribute("aria-label", "Navegação mobile");
    this.items.forEach((item) => nav.append(this.navigationButton(item)));
    drawer.append(profile, nav); root.append(overlay, drawer); this.root = root; this.drawer = drawer; return root;
  }

  public mount(container: HTMLElement): void { this.unmount(); container.append(this.render()); }
  public unmount(): void { this.close(false); this.root?.remove(); this.root = null; this.drawer = null; }
  public toggle(): void { this.openState ? this.close() : this.open(); }

  public open(): void {
    if (this.openState || !this.root || !this.drawer) return;
    this.returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.openState = true; this.root.classList.add("mobile-navigation--open"); this.drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open"); document.addEventListener("keydown", this.handleKeydown);
    this.onStateChange(true); window.setTimeout(() => this.drawer?.querySelector<HTMLButtonElement>(".drawer-link")?.focus(), MobileNavigationDrawer.motionDuration);
  }

  public close(restoreFocus = true): void {
    if (!this.openState) return;
    this.openState = false; this.root?.classList.remove("mobile-navigation--open"); this.drawer?.setAttribute("aria-hidden", "true");
    document.body.classList.remove("drawer-open"); document.removeEventListener("keydown", this.handleKeydown);
    this.onStateChange(false); if (restoreFocus) window.setTimeout(() => this.returnFocusTo?.focus(), MobileNavigationDrawer.motionDuration);
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") { event.preventDefault(); this.close(); return; }
    if (event.key !== "Tab" || !this.drawer) return;
    const focusable = [...this.drawer.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")];
    const first = focusable[0], last = focusable.at(-1); if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  private navigationButton(item: NavigationItem): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button";
    button.className = `drawer-link${item.primary ? " drawer-link--primary" : ""}`;
    const icon = document.createElement("span"); icon.className = "drawer-link__icon"; icon.textContent = item.icon; icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span"); label.textContent = item.label; button.append(icon, label);
    if (item.route && window.location.pathname === `/${item.route}`) { button.classList.add("drawer-link--current"); button.setAttribute("aria-current", "page"); }
    button.addEventListener("click", () => { this.close(false); item.route ? this.onNavigate(item.route) : this.onLogout(); }); return button;
  }
}
