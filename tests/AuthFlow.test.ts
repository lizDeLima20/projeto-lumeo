import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppState } from "../src/core/AppState";
import { ApiError } from "../src/services/ApiClient";
import { DeviceManager } from "../src/services/DeviceManager";

describe("fluxo de autenticação do frontend", () => {
  it("deviceManagerDoesNotCallApiBeforeAuthentication", async () => {
    const state = new AppState();
    state.authStatus = "unauthenticated";
    state.currentUser = null;
    let called = false;
    const api = {
      get: async () => { called = true; return { status: "unregistered" }; },
      post: async () => { called = true; return { status: "authorized" }; },
      setInstallationId: () => undefined,
    } as never;
    const storage = { load: async () => null, save: async () => undefined } as never;
    const devices = new DeviceManager(api, storage, state);
    await assert.rejects(() => devices.ensureAuthorized(),
      (error: unknown) => error instanceof ApiError && error.code === "AUTH_REQUIRED");
    assert.equal(called, false);
  });

  it("deviceManagerCallsApiAfterAuthentication", async () => {
    const state = new AppState();
    state.authStatus = "authenticated";
    state.currentUser = { id: "user-1", email: "user@example.com" };
    let called = false;
    const api = {
      get: async () => { called = true; return { status: "authorized" }; },
      post: async () => { throw new Error("not used"); },
      setInstallationId: () => undefined,
    } as never;
    const storage = { load: async () => null, save: async () => undefined } as never;
    const devices = new DeviceManager(api, storage, state);
    assert.equal((await devices.ensureAuthorized()).status, "authorized");
    assert.equal(called, true);
  });
});
