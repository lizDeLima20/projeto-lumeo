import { createHash, randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { DRIVE_FILE_SCOPE, GoogleDriveEditionStore } from "./DriveEditionStore.js";

/**
 * One-time sign-in of the worker to Google Drive, as the account that owns the catalog.
 *
 *   npm run worker:kindle:drive-auth
 *
 * Needs KINDLE_DRIVE_CLIENT_ID and KINDLE_DRIVE_CLIENT_SECRET (an OAuth client of type
 * "Desktop app") in worker/kindle-converter/.env. It prints a Google address; after "Allow", the
 * refresh token is written into that same .env (not committed, never printed) and the
 * "Lumeo Kindle AZW3" folder is found or created. Only the drive.file scope is asked for: the
 * worker sees nothing in the Drive except what it creates itself.
 */
const envFile = resolve(process.argv[process.argv.indexOf("--env-file") + 1] && process.argv.includes("--env-file") ? process.argv[process.argv.indexOf("--env-file") + 1]! : "worker/kindle-converter/.env");
const TIMEOUT_MS = 10 * 60_000;

async function main(): Promise<void> {
  const text = await readFile(envFile, "utf8").catch(() => { throw new Error(`Não encontrei ${envFile}. Copie env.example para .env e preencha KINDLE_DRIVE_CLIENT_ID e KINDLE_DRIVE_CLIENT_SECRET.`); });
  const value = (name: string) => text.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
  const clientId = value("KINDLE_DRIVE_CLIENT_ID"), clientSecret = value("KINDLE_DRIVE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error(`Preencha KINDLE_DRIVE_CLIENT_ID e KINDLE_DRIVE_CLIENT_SECRET em ${envFile}.`);

  const verifier = randomBytes(48).toString("base64url"), state = randomBytes(16).toString("hex");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((done, fail) => {
    let redirectUri = "";
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", redirectUri);
      if (url.pathname !== "/") { response.statusCode = 404; response.end(); return; }
      const ok = url.searchParams.get("state") === state && url.searchParams.get("code");
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(ok ? "<p>Lumeo: autorização recebida. Pode fechar esta aba.</p>" : "<p>Lumeo: autorização recusada ou inválida.</p>");
      clearTimeout(timer); server.close();
      if (ok) done({ code: url.searchParams.get("code")!, redirectUri }); else fail(new Error(`Autorização não concluída (${url.searchParams.get("error") ?? "state inválido"}).`));
    });
    const timer = setTimeout(() => { server.close(); fail(new Error("Tempo esgotado esperando a autorização (10 min).")); }, TIMEOUT_MS);
    // Only this computer can reach it.
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      redirectUri = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
      const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      consent.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: DRIVE_FILE_SCOPE, access_type: "offline", prompt: "consent", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
      console.log("\nAbra este endereço no navegador deste computador, entre com a conta Google dona do catálogo e clique em Permitir:\n");
      console.log(consent.toString());
      console.log("\nAguardando…");
    });
  });

  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier }) });
  const token = await response.json() as { refresh_token?: string; scope?: string; error?: string; error_description?: string };
  if (!response.ok || !token.refresh_token) throw new Error(`O Google não devolveu o token de atualização (${token.error ?? response.status}${token.error_description ? `: ${token.error_description}` : ""}).`);
  if (!token.scope?.split(" ").includes(DRIVE_FILE_SCOPE)) throw new Error("A permissão de arquivos do Drive não foi concedida. Rode de novo e marque o acesso ao Drive.");

  // Replaces (or adds) only this line; the rest of the .env stays as it was.
  const line = `KINDLE_DRIVE_REFRESH_TOKEN=${token.refresh_token}`;
  const updated = /^KINDLE_DRIVE_REFRESH_TOKEN=.*$/m.test(text) ? text.replace(/^KINDLE_DRIVE_REFRESH_TOKEN=.*$/m, line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
  await writeFile(envFile, updated, { mode: 0o600 });
  await chmod(envFile, 0o600);
  console.log(`\nToken salvo em ${envFile} (não é enviado ao git).`);

  const store = new GoogleDriveEditionStore({ clientId, clientSecret, refreshToken: token.refresh_token }, { folderId: value("KINDLE_DRIVE_FOLDER_ID") || undefined, folderName: value("KINDLE_DRIVE_FOLDER_NAME") || undefined });
  const folderId = await store.folderId();
  console.log(`Pasta de saída pronta: https://drive.google.com/drive/folders/${folderId}`);
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
