// Cadastra e administra os leitores do catálogo OPDS (KOReader).
//
//   npm run opds:user -- add <usuario>       cria (ou troca a senha de) um usuário
//   npm run opds:user -- disable <usuario>   bloqueia o acesso
//   npm run opds:user -- enable <usuario>    libera de novo
//   npm run opds:user -- list                lista os usuários
//
// A senha é pedida no terminal sem aparecer na tela (ou lida de OPDS_PASSWORD, para uso
// sem terminal) e só o hash bcrypt vai para o Supabase. Usa SUPABASE_URL e
// SUPABASE_SECRET_KEY (ou SUPABASE_SERVICE_ROLE_KEY) do ambiente ou do .env do projeto.
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline";
import { EnvFileLoader } from "../server/src/config/EnvFileLoader.js";
import { hashOpdsPassword } from "../server/src/opds/OpdsAuth.js";

EnvFileLoader.loadProjectEnv(import.meta.url);
const [command, rawUsername] = process.argv.slice(2);
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("Defina SUPABASE_URL e SUPABASE_SECRET_KEY (service role) no ambiente ou no .env.");
const database = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
const username = rawUsername?.trim().toLocaleLowerCase("en-US") ?? "";

if (command === "list") {
  const { data, error } = await database.from("opds_users").select("username,ativo,created_at").order("username");
  if (error) fail(error.message);
  for (const row of data ?? []) console.log(`${row.username}\t${row.ativo ? "ativo" : "bloqueado"}\t${row.created_at}`);
} else if (command === "add") {
  if (!/^[a-z0-9._@-]{3,120}$/.test(username)) fail("Usuário inválido: use de 3 a 120 letras minúsculas, números, ponto, hífen, _ ou @.");
  const password = process.env.OPDS_PASSWORD ?? await askHidden(`Senha para ${username}: `);
  if (password.length < 10) fail("A senha precisa ter pelo menos 10 caracteres.");
  if (!process.env.OPDS_PASSWORD && password !== await askHidden("Repita a senha: ")) fail("As senhas não conferem.");
  const { error } = await database.from("opds_users").upsert({ username, password_hash: await hashOpdsPassword(password), ativo: true }, { onConflict: "username" });
  if (error) fail(error.message);
  console.log(`Usuário ${username} pronto para o catálogo OPDS.`);
} else if (command === "disable" || command === "enable") {
  const { data, error } = await database.from("opds_users").update({ ativo: command === "enable" }).eq("username", username).select("username");
  if (error) fail(error.message);
  if (!data?.length) fail(`Usuário ${username} não encontrado.`);
  console.log(`Usuário ${username} ${command === "enable" ? "liberado" : "bloqueado"}.`);
} else {
  fail("Uso: npm run opds:user -- add|disable|enable <usuario>  ou  npm run opds:user -- list");
}

function fail(message: string): never { console.error(message); process.exit(1); }

/** Reads a line from the terminal without echoing it. */
function askHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) fail("Sem terminal interativo: informe a senha em OPDS_PASSWORD.");
  return new Promise(resolve => {
    const input = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (input as unknown as { _writeToOutput: (text: string) => void });
    write._writeToOutput = (text: string) => { if (text.includes(prompt)) process.stdout.write(prompt); };
    input.question(prompt, answer => { input.close(); process.stdout.write("\n"); resolve(answer); });
  });
}
