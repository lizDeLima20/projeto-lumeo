import { Config } from "./config/Config.js";
import { EnvFileLoader } from "./config/EnvFileLoader.js";
import { SupabaseService } from "./services/SupabaseService.js";

async function main(): Promise<void> {
  EnvFileLoader.loadProjectEnv(import.meta.url);
  const config = Config.fromEnvironment();
  Config.assertSupabase(config);
  const supabase = new SupabaseService(config);
  const email = process.env.SMOKE_TEST_EMAIL ?? `lumeo.smoke.${Date.now()}@gmail.com`;
  const password = process.env.SMOKE_TEST_PASSWORD ?? `LumeoSmoke-${crypto.randomUUID()}-Aa1!`;
  let createdUserId: string | null = null;
  const tested = ["login", "refresh", "getUser", "logout"];

  try {
    const signup = await supabase.auth.auth.signUp({ email, password });
    if (signup.error) {
      if (!isEmailRateLimit(signup.error.message)) throw signup.error;
      const created = await supabase.admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw created.error ?? new Error("Criação administrativa de smoke falhou.");
      createdUserId = created.data.user.id;
      tested.unshift("adminCreateUserFallback");
    } else {
      createdUserId = signup.data.user?.id ?? null;
      tested.unshift("signup");
      if (createdUserId) {
        const confirmation = await supabase.admin.auth.admin.updateUserById(createdUserId, { email_confirm: true });
        if (confirmation.error) throw confirmation.error;
      }
    }
    const login = await supabase.auth.auth.signInWithPassword({ email, password });
    if (login.error || !login.data.session) throw login.error ?? new Error("Login não retornou sessão.");
    const refresh = await supabase.auth.auth.refreshSession({ refresh_token: login.data.session.refresh_token });
    if (refresh.error || !refresh.data.session) throw refresh.error ?? new Error("Refresh não retornou sessão.");
    const ownUser = await supabase.auth.auth.getUser(refresh.data.session.access_token);
    if (ownUser.error || !ownUser.data.user) throw ownUser.error ?? new Error("Profile/auth user indisponível.");
    await supabase.auth.auth.signOut();
    console.info(JSON.stringify({ ok: true, supabaseUrl: config.supabaseUrl, tested }));
  } finally {
    if (createdUserId) await supabase.admin.auth.admin.deleteUser(createdUserId);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function isEmailRateLimit(message: string): boolean {
  return /email rate limit/i.test(message);
}
