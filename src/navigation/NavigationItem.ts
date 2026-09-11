import type { RouteName } from "../core/Router";
import type { TranslationKey } from "../i18n/I18nManager";

export interface NavigationItem {
  labelKey: TranslationKey;
  route?: RouteName;
  action?: "logout";
  icon: string;
  primary?: boolean;
}

export const AUTHENTICATED_NAVIGATION: readonly NavigationItem[] = [
  { labelKey: "ui.import.title", route: "import", icon: "+", primary: true },
  { labelKey: "ui.navigation.home", route: "home", icon: "⌂" },
  { labelKey: "ui.navigation.library", route: "library", icon: "▤" },
  { labelKey: "ui.settings.title", route: "settings", icon: "⚙" },
  { labelKey: "ui.navigation.logout", action: "logout", icon: "↗" },
];
