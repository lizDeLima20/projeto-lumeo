import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const SUPABASE_URL = "https://rasonfawfsvyfhjkinbp.supabase.co";

describe("configuração Supabase produção", () => {
  it("envExampleUsesRealSupabaseUrlWithoutSecrets", async () => {
    const env = await readFile(new URL("../.env.example", import.meta.url), "utf8");
    assert.match(env, new RegExp(`SUPABASE_URL=${SUPABASE_URL}`));
    assert.match(env, new RegExp(`VITE_SUPABASE_URL=${SUPABASE_URL}`));
    assert.match(env, /SUPABASE_SECRET_KEY=\n/);
    assert.match(env, /VITE_SUPABASE_PUBLISHABLE_KEY=\n/);
    assert.match(env, /SUPABASE_ANON_KEY=\n/);
    assert.match(env, /SUPABASE_SERVICE_ROLE_KEY=\n/);
    assert.doesNotMatch(env, /SUPABASE_SECRET_KEY=sb_secret_/);
    assert.doesNotMatch(env, /VITE_SUPABASE_.*sb_secret_/);
  });

  it("envFilesAreGitIgnoredButExampleIsTracked", async () => {
    const ignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
    assert.match(ignore, /^\.env$/m);
    assert.match(ignore, /^\.env\.\*$/m);
    assert.match(ignore, /^!\.env\.example$/m);
  });

  it("rlsPoliciesBlockCrossUserAccessByUserId", async () => {
    const sql = await readFile(new URL("../supabase/migrations/202609080002_rls_indexes_prod.sql", import.meta.url), "utf8");
    assert.match(sql, /alter table public\.profiles enable row level security/);
    assert.match(sql, /auth\.uid\(\) = user_id/);
    assert.match(sql, /profiles_select_own/);
    assert.match(sql, /devices_select_own/);
    assert.match(sql, /licenses_select_own/);
  });

  it("supabaseIndexesSupportProductionQueries", async () => {
    const sql = await readFile(new URL("../supabase/migrations/202609080002_rls_indexes_prod.sql", import.meta.url), "utf8");
    assert.match(sql, /devices_user_hash_idx/);
    assert.match(sql, /licenses_status_idx/);
    assert.match(sql, /created_at_idx/);
  });
});
