import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { MobileNavigationDrawer } from "../src/views/MobileNavigationDrawer";

const source = readFileSync(new URL("../src/views/MobileNavigationDrawer.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles/components.css", import.meta.url), "utf8");

describe("MobileNavigationDrawer", () => {
  it("drawerHasOwnBackground", () => {
    assert.equal(MobileNavigationDrawer.hasOwnBackground, true);
    assert.match(styles, /\.navigation-drawer[^}]*background:\s*linear-gradient/s);
  });
  it("drawerOverlayOpens", () => {
    assert.equal(MobileNavigationDrawer.hasOverlay, true);
    assert.match(styles, /\.mobile-navigation--open \.drawer-overlay\s*{\s*opacity:\s*1/);
  });
  it("drawerBackdropCloses", () => assert.match(source, /overlay\.addEventListener\("click", \(\) => this\.close\(\)\)/));
  it("drawerEscapeCloses", () => assert.match(source, /event\.key === "Escape"[\s\S]*this\.close\(\)/));
  it("drawerRestoresFocus", () => assert.match(source, /this\.returnFocusTo\?\.focus\(\)/));
  it("keeps privacy separated in the drawer footer", () => {
    assert.match(source, /className = "drawer-footer"/);
    assert.match(source, /this\.onNavigate\("privacy"\)/);
    assert.match(styles, /\.drawer-footer[^}]*margin-top:\s*auto/s);
  });
});
