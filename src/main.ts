import "./styles/reset.css";
import "./styles/variables.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/onboarding.css";
import "./styles/library.css";
import "./styles/book-physical.css";
import "./styles/auth.css";
import "./styles/home.css";
import "@fontsource-variable/literata";
import "./styles/reader.css";
import "./styles/reading-review.css";
import "./styles/comic.css";
import "./styles/catalog.css";
import "./styles/privacy.css";
import "./styles/native-launch-splash.css";
import { App } from "./core/App";
import { EnvironmentConfig } from "./config/EnvironmentConfig";
import { GlobalErrorHandler } from "./errors/GlobalErrorHandler";
import { I18nManager } from "./i18n/I18nManager";
import { AndroidRuntimeDiagnostics } from "./platform/AndroidRuntimeDiagnostics";
import { NativeLaunchSplash } from "./platform/NativeLaunchSplash";
import { ServiceWorkerRegistrationService } from "./pwa/ServiceWorkerRegistrationService";

const outlet = document.querySelector<HTMLElement>("#app");
const header = document.querySelector<HTMLElement>("#app-header");
const footer = document.querySelector<HTMLElement>("#app-footer");

if (!outlet || !header || !footer) throw new Error("Os containers principais da aplicação não foram encontrados.");

const errors = new GlobalErrorHandler(outlet);
errors.bind();
const app = new App(outlet, header, footer);
const nativeSplash = new NativeLaunchSplash();
void (async () => {
  await I18nManager.shared.initialize();
  nativeSplash.show();
  AndroidRuntimeDiagnostics.start(new EnvironmentConfig().read());
  await app.start();
  await nativeSplash.hide();
})().catch(async error => {
  await nativeSplash.hide();
  errors.showStartupFailure(error);
});
new ServiceWorkerRegistrationService().register(import.meta.env.PROD);
