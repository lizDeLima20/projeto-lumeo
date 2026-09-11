import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PwaInstallManager } from "../src/pwa/PwaInstallManager";

type Listener = (event: Event) => void;
function fakeBrowser(standalone = false) {
  const listeners = new Map<string, Listener[]>();
  const scope = globalThis as unknown as Record<string, unknown>;
  const previous = { window: scope.window, navigator: scope.navigator };
  scope.window = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    matchMedia: () => ({ matches: standalone }),
  };
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/140", platform: "Linux", maxTouchPoints: 5 }, configurable: true });
  const fire = (type: string, event: Event) => (listeners.get(type) ?? []).forEach((listener) => listener(event));
  const restore = () => { scope.window = previous.window; Object.defineProperty(globalThis, "navigator", { value: previous.navigator, configurable: true }); };
  return { fire, restore };
}
function promptEvent(outcome: "accepted" | "dismissed") {
  let prevented = false, prompted = false;
  const event = { preventDefault: () => { prevented = true; }, prompt: async () => { prompted = true; }, userChoice: Promise.resolve({ outcome, platform: "web" }) } as unknown as Event;
  return { event, prevented: () => prevented, prompted: () => prompted };
}

describe("instalacao do PWA", () => {
  it("nao esconde a oferta nativa do Chrome, mas guarda o evento para o botao", async () => {
    const browser = fakeBrowser();
    try {
      const manager = new PwaInstallManager(); manager.bind();
      let changes = 0; manager.onChange(() => changes++);
      assert.equal(manager.available, false);
      const offer = promptEvent("accepted"); browser.fire("beforeinstallprompt", offer.event);
      assert.equal(offer.prevented(), false, "preventDefault escondia a instalacao no Android");
      assert.equal(manager.available, true); assert.equal(changes, 1);
      assert.equal(await manager.install(), "accepted"); assert.equal(offer.prompted(), true);
      assert.equal(manager.available, false, "um evento de instalacao so pode ser usado uma vez"); assert.equal(changes, 2);
    } finally { browser.restore(); }
  });
  it("instalado nao oferece o botao; recusar nao quebra o proximo convite", async () => {
    const installed = fakeBrowser(true);
    try { const manager = new PwaInstallManager(); manager.bind(); installed.fire("beforeinstallprompt", promptEvent("accepted").event); assert.equal(manager.installed, true); assert.equal(manager.available, false); }
    finally { installed.restore(); }
    const browser = fakeBrowser();
    try {
      const manager = new PwaInstallManager(); manager.bind();
      browser.fire("beforeinstallprompt", promptEvent("dismissed").event);
      assert.equal(await manager.install(), "dismissed");
      browser.fire("beforeinstallprompt", promptEvent("accepted").event);
      assert.equal(manager.available, true, "o botao das configuracoes nao espera o cooldown");
    } finally { browser.restore(); }
  });
  it("um prompt que falha nao deixa o botao travado", async () => {
    const browser = fakeBrowser();
    try {
      const manager = new PwaInstallManager(); manager.bind();
      browser.fire("beforeinstallprompt", { prompt: async () => { throw new Error("gesture required"); }, userChoice: new Promise(() => undefined) } as unknown as Event);
      assert.equal(await manager.install(), "unavailable"); assert.equal(manager.available, false);
    } finally { browser.restore(); }
  });
});
