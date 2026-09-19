import { BaseView } from "../views/BaseView";

export type RouteName = "login" | "register" | "privacy" | "onboarding" | "home" | "library" | "explore" | "catalog-book" | "catalog-admin" | "genre" | "settings" | "device-conflict" | "import" | "book" | "reader" | "edit-book" | "audiobooks";
type ViewFactory = (params: URLSearchParams) => BaseView;

export class Router {
  private readonly routes = new Map<RouteName, ViewFactory>();
  private activeView: BaseView | null = null;
  private activeRoute: RouteName | null = null;
  private activeParameters = new URLSearchParams();
  private guard: (route: RouteName) => RouteName = (route) => route;

  public constructor(private readonly outlet: HTMLElement) {}

  public register(route: RouteName, factory: ViewFactory): void {
    this.routes.set(route, factory);
  }

  public setGuard(guard: (route: RouteName) => RouteName): void { this.guard = guard; }

  public start(initialRoute: RouteName): void {
    window.addEventListener("popstate", () => this.renderFromLocation(initialRoute));
    this.renderFromLocation(initialRoute);
  }

  public navigate(route: RouteName, params: Record<string, string> = {}): void {
    route = this.guard(route);
    const url = new URL(window.location.href);
    url.pathname = `/${route}`;
    url.search = new URLSearchParams(params).toString();
    window.history.pushState({}, "", url);
    this.render(route, url.searchParams);
  }

  /** Repaints chrome after an interface-locale switch without changing URL or state. */
  public refresh(): void { if (this.activeRoute) this.render(this.activeRoute, new URLSearchParams(this.activeParameters)); }
  public get currentRoute(): RouteName | null { return this.activeRoute; }

  private renderFromLocation(fallback: RouteName): void {
    const params = new URLSearchParams(window.location.search);
    const requested = window.location.pathname.slice(1) as RouteName;
    const route = this.guard(requested && this.routes.has(requested) ? requested : fallback);
    if (route !== requested) {
      const url = new URL(window.location.href);
      url.pathname = `/${route}`;
      url.search = "";
      window.history.replaceState({}, "", url);
    }
    this.render(route, params);
  }

  private render(route: RouteName, params: URLSearchParams): void {
    const factory = this.routes.get(route);
    if (!factory) return;
    this.activeView?.unmount();
    this.activeRoute = route;
    this.activeParameters = new URLSearchParams(params);
    this.activeView = factory(params);
    this.activeView.mount(this.outlet);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}
