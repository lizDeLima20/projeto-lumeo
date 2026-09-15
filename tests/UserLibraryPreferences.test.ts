import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { IndexedDbService } from "../src/services/IndexedDbService";
import { UserLibraryPreferencesRepository } from "../src/repositories/UserLibraryPreferencesRepository";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

describe("preferências persistentes da biblioteca", () => {
  it("mantém onboarding, tema e gêneros ao reabrir o banco do mesmo usuário", async () => {
    const databaseName = `lumeo-library-user-a-${crypto.randomUUID()}`;
    const first = new UserLibraryPreferencesRepository(new IndexedDbService(databaseName));
    await first.save({
      onboardingCompleted: true,
      theme: "dark",
      genres: [{ id: "history", name: "História" }],
    });

    const reopened = new UserLibraryPreferencesRepository(new IndexedDbService(databaseName));
    assert.deepEqual(await reopened.load(), {
      onboardingCompleted: true,
      theme: "dark",
      genres: [{ id: "history", name: "História" }],
    });
  });

  it("não mistura preferências entre bancos de usuários distintos", async () => {
    const first = new UserLibraryPreferencesRepository(new IndexedDbService(`lumeo-library-user-a-${crypto.randomUUID()}`));
    const second = new UserLibraryPreferencesRepository(new IndexedDbService(`lumeo-library-user-b-${crypto.randomUUID()}`));
    await first.save({ onboardingCompleted: true, theme: "light", genres: [{ id: "fiction", name: "Ficção" }] });

    assert.equal(await second.load(), null);
  });
});
