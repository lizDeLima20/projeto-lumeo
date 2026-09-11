import type { RouteName } from "../core/Router";
import { I18nManager, type TranslationKey } from "../i18n/I18nManager";

interface BottomNavigationItem { labelKey: TranslationKey; icon: string; route: RouteName; }

export class MobileBottomNavigation {
  private readonly items: readonly BottomNavigationItem[] = [
    { labelKey: "ui.navigation.library", icon: "⌂", route: "library" },
    { labelKey: "ui.navigation.home", icon: "⌕", route: "home" },
    { labelKey: "ui.navigation.add", icon: "+", route: "import" },
    { labelKey: "ui.navigation.settings", icon: "♙", route: "settings" },
  ];
  public constructor(private readonly onNavigate: (route: RouteName) => void) {}
  public render(): HTMLElement {
    const nav=document.createElement("nav");nav.className="mobile-bottom-navigation";nav.setAttribute("aria-label",I18nManager.shared.t("ui.navigation.bottom"));
    this.items.forEach(item=>{const button=document.createElement("button");button.type="button";button.className="mobile-bottom-navigation__item";button.dataset.route=item.route;
      const icon=document.createElement("span");icon.className="mobile-bottom-navigation__icon";icon.textContent=item.icon;icon.setAttribute("aria-hidden","true");
      const label=document.createElement("span");label.textContent=I18nManager.shared.t(item.labelKey);button.append(icon,label);this.markCurrent(button,item.route);
      button.addEventListener("click",()=>{nav.querySelectorAll("[aria-current]").forEach(current=>current.removeAttribute("aria-current"));button.setAttribute("aria-current","page");this.onNavigate(item.route);});nav.append(button);});
    return nav;
  }
  private markCurrent(button:HTMLButtonElement,route:RouteName):void{if(window.location.pathname===`/${route}`)button.setAttribute("aria-current","page");}
}
