import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LocalAuthService } from "../src/services/LocalAuthService.js";

describe("identidade local persistente", () => {
  it("stableDevUser após reiniciar o serviço", async () => { const first = await new LocalAuthService().signup("reader@example.com", "secret123"), second = await new LocalAuthService().login("reader@example.com", "secret123"); assert.equal(first.user.id, second.user.id); });
});
