import type { RouteName } from "../core/Router";

interface BottomNavigationItem { label: string; icon: string; route: RouteName; }

export class MobileBottomNavigation {
  private readonly items: readonly BottomNavigationItem[] = [
    { label: "Biblioteca", icon: "⌂", route: "library" },
    { label: "Início", icon: "⌕", route: "home" },
    { label: "Adicionar", icon: "+", route: "import" },
    { label: "Ajustes", icon: "♙", route: "settings" },
  ];
  public constructor(private readonly onNavigate: (route: RouteName) => void) {}
  public render(): HTMLElement {
    const nav=document.createElement("nav");nav.className="mobile-bottom-navigation";nav.setAttribute("aria-label","Navegação inferior");
    this.items.forEach(item=>{const button=document.createElement("button");button.type="button";button.className="mobile-bottom-navigation__item";button.dataset.route=item.route;
      const icon=document.createElement("span");icon.className="mobile-bottom-navigation__icon";icon.textContent=item.icon;icon.setAttribute("aria-hidden","true");
      const label=document.createElement("span");label.textContent=item.label;button.append(icon,label);this.markCurrent(button,item.route);
      button.addEventListener("click",()=>{nav.querySelectorAll("[aria-current]").forEach(current=>current.removeAttribute("aria-current"));button.setAttribute("aria-current","page");this.onNavigate(item.route);});nav.append(button);});
    return nav;
  }
  private markCurrent(button:HTMLButtonElement,route:RouteName):void{if(window.location.pathname===`/${route}`)button.setAttribute("aria-current","page");}
}
