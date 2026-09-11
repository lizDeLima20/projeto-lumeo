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
import "./styles/reader.css";
import { App } from "./core/App";
import { GlobalErrorHandler } from "./errors/GlobalErrorHandler";
import { ServiceWorkerRegistrationService } from "./pwa/ServiceWorkerRegistrationService";

const outlet = document.querySelector<HTMLElement>("#app");
const header = document.querySelector<HTMLElement>("#app-header");
const footer = document.querySelector<HTMLElement>("#app-footer");

if (!outlet || !header || !footer) throw new Error("Os containers principais da aplicação não foram encontrados.");

const errors = new GlobalErrorHandler(outlet);
errors.bind();
const app = new App(outlet, header, footer);
void app.start().catch(error => errors.showStartupFailure(error));
new ServiceWorkerRegistrationService().register(import.meta.env.PROD);
