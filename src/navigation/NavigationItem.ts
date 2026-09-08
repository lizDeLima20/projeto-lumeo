import type { RouteName } from "../core/Router";

export interface NavigationItem {
  label: string;
  route?: RouteName;
  action?: "logout";
  icon: string;
  primary?: boolean;
}

export const AUTHENTICATED_NAVIGATION: readonly NavigationItem[] = [
  { label: "Adicionar livro", route: "import", icon: "+", primary: true },
  { label: "Início", route: "home", icon: "⌂" },
  { label: "Biblioteca", route: "library", icon: "▤" },
  { label: "Configurações", route: "settings", icon: "⚙" },
  { label: "Sair", action: "logout", icon: "↗" },
];
