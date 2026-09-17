import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AppState } from "../src/core/AppState";
import { ApiClient } from "../src/services/ApiClient";
import { AuthManager, type AuthSession } from "../src/services/AuthManager";
import type { StorageAdapter } from "../src/services/StorageService";

class MemoryStorage implements StorageAdapter {
  private readonly values = new Map<string, unknown>();
  public async load<T>(key: string): Promise<T | null> { return this.values.get(key) as T ?? null; }
  public async save<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
  public async remove(key: string): Promise<void> { this.values.delete(key); }
}

const session = (expiresAt: number | null = null): AuthSession => ({
  accessToken: "access-token", refreshToken: "refresh-token-with-safe-length", expiresAt,
  user: { id: "user-1", email: "reader@example.com" },
});

describe("sessão persistida", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("restaura uma sessão válida sem chamar refresh", async () => {
    const storage = new MemoryStorage(), state = new AppState();
    await storage.save("auth-session", session(Math.floor(Date.now() / 1000) + 3600));
    let refreshCalls = 0;
    const auth = new AuthManager({ setAccessToken: () => undefined, setSessionRefreshHandler: () => undefined, post: async () => { refreshCalls++; return session(); } } as never, storage as never, state);
    await auth.initialize();
    assert.equal(refreshCalls, 0);
    assert.equal(state.currentUser?.id, "user-1");
    assert.equal(state.authStatus, "SESSION_RESTORED");
  });

  it("renova a sessão expirada e persiste os tokens renovados", async () => {
    const storage = new MemoryStorage(), state = new AppState();
    await storage.save("auth-session", session(1));
    const renewed = { ...session(Math.floor(Date.now() / 1000) + 3600), accessToken: "new-access", refreshToken: "new-refresh-token-with-safe-length" };
    const auth = new AuthManager({ setAccessToken: () => undefined, setSessionRefreshHandler: () => undefined, post: async () => renewed } as never, storage as never, state);
    await auth.initialize();
    assert.equal((await storage.load<AuthSession>("auth-session"))?.accessToken, "new-access");
    assert.equal(state.authStatus, "SESSION_RESTORED");
  });

  it("repete uma única chamada protegida após 401 e refresh", async () => {
    const api = new ApiClient("https://api.example.test");
    api.setAccessToken("old-access");
    let attempts = 0, refreshes = 0;
    api.setSessionRefreshHandler(async () => { refreshes++; api.setAccessToken("new-access"); });
    globalThis.fetch = (async (_input, init) => {
      attempts++;
      const token = new Headers(init?.headers).get("Authorization");
      return token === "Bearer old-access" ? Response.json({ code: "INVALID_TOKEN" }, { status: 401 }) : Response.json({ ok: true });
    }) as typeof fetch;
    assert.deepEqual(await api.get("/protected"), { ok: true });
    assert.equal(refreshes, 1);
    assert.equal(attempts, 2);
  });
});
