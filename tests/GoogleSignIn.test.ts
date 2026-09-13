import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { GoogleSignIn } from "../src/services/GoogleSignIn";
import { AuthManager } from "../src/services/AuthManager";
import { AppState } from "../src/core/AppState";

describe("entrar e cadastrar com Google", () => {
  it("o Google ve so o hash do nonce; o servidor recebe o valor original", async () => {
    const { raw, hashed } = await GoogleSignIn.nonce();
    assert.match(raw, /^[0-9a-f]{48}$/);
    assert.equal(hashed, createHash("sha256").update(raw).digest("hex"));
    const other = await GoogleSignIn.nonce();
    assert.notEqual(other.raw, raw, "cada tentativa usa um nonce novo");
  });

  it("sem Client ID o botao existe, mas se declara nao configurado", () => {
    assert.equal(new GoogleSignIn("").configured, false);
    assert.equal(new GoogleSignIn("   ").configured, false);
    assert.equal(new GoogleSignIn("123-abc.apps.googleusercontent.com").configured, true);
  });

  it("o token do Google vira a mesma sessao do login por senha", async () => {
    const posts: Array<{ path: string; body: unknown; authenticated: boolean }> = [];
    let token: string | null = null;
    const api = {
      post: async (path: string, body: unknown, authenticated: boolean) => { posts.push({ path, body, authenticated }); return { accessToken: "access-token-value", refreshToken: "refresh-token-value", expiresAt: null, user: { id: "u-1", email: "leitor@gmail.com" } }; },
      setAccessToken: (value: string | null) => { token = value; },
    };
    const saved = new Map<string, unknown>();
    const storage = { load: async (key: string) => saved.get(key) ?? null, save: async (key: string, value: unknown) => { saved.set(key, value); }, remove: async (key: string) => { saved.delete(key); } };
    const state = new AppState();
    await new AuthManager(api as never, storage as never, state).loginWithGoogle("google-id-token", "raw-nonce-value-0000");
    assert.deepEqual(posts, [{ path: "/auth/google", body: { credential: "google-id-token", nonce: "raw-nonce-value-0000" }, authenticated: false }]);
    assert.equal(token, "access-token-value");
    assert.equal(state.currentUser?.email, "leitor@gmail.com");
    assert.ok(saved.get("auth-session"), "a sessao e guardada como no login por senha");
  });

  it("login, cadastro e troca de aparelho oferecem um único Google Identity, e a CSP deixa o SDK carregar", async () => {
    for (const view of ["LoginView", "RegisterView", "DeviceConflictView"]) assert.match(await readFile(`src/views/${view}.ts`, "utf8"), /new GoogleAuthButton\(/, `${view} sem opcao Google`);
    const conflict = await readFile("src/views/DeviceConflictView.ts", "utf8");
    assert.match(conflict, /googleAccountMismatch/, "trocar aparelho com outra conta Google tem que ser recusado");
    const vercel = await readFile("vercel.json", "utf8");
    assert.match(vercel, /script-src[^;]*https:\/\/accounts\.google\.com\/gsi\/client/);
    assert.match(vercel, /style-src[^;]*https:\/\/accounts\.google\.com\/gsi\/style/);
    assert.match(vercel, /frame-src[^;]*https:\/\/accounts\.google\.com/);
    const identity = await readFile("src/services/GoogleIdentityServices.ts", "utf8");
    const drive = await readFile("src/services/GoogleDriveAuthorizationProvider.ts", "utf8");
    assert.match(identity, /private static loading/, "SDK GIS deve carregar uma única vez");
    assert.match(drive, /private static readonly clients/, "TokenClient deve ser reutilizado por Client ID e escopo");
    assert.match(drive, /initTokenClient/, "Drive deve usar o token client OAuth2, não um ID token");
  });
});
