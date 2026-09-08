import { createServer } from "node:http";
import { Config } from "./config/Config.js";
import { EnvFileLoader } from "./config/EnvFileLoader.js";
import { ServerApp } from "./app.js";

const envFileLoaded = EnvFileLoader.loadProjectEnv(import.meta.url);
const config = Config.fromEnvironment();
console.info(JSON.stringify({ event: "lumeo.bff.config", envFileLoaded, ...EnvFileLoader.presence() }));
if (config.localAuthMode) console.warn("Lumeo: autenticação local temporária habilitada (somente desenvolvimento).");
const handler = ServerApp.create(config);
const server = createServer((request, response) => void handler(request, response));
server.listen(config.port, "127.0.0.1", () => {
  console.log(`Lumeo BFF disponível em http://127.0.0.1:${config.port}`);
});
