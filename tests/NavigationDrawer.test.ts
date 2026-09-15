import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { MobileNavigationDrawer } from "../src/views/MobileNavigationDrawer";

const source = readFileSync(new URL("../src/views/MobileNavigationDrawer.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles/components.css", import.meta.url), "utf8");
const header = readFileSync(new URL("../src/views/HeaderView.ts", import.meta.url), "utf8");

describe("MobileNavigationDrawer", () => {
  it("drawerHasOwnBackground", () => {
    assert.equal(MobileNavigationDrawer.hasOwnBackground, true);
    assert.match(styles, /\.navigation-drawer[^}]*background:\s*rgba\(245, 245, 247, \.94\)/s);
    assert.match(styles, /\.drawer-link[^}]*color:\s*#24212b/s);
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
  it("fits between the mobile header and bottom navigation with internal scrolling", () => {
    assert.match(styles, /\.mobile-navigation[^}]*top:\s*5\.35rem[^}]*bottom:\s*calc\(5\.5rem \+ env\(safe-area-inset-bottom\)\)/s);
    assert.match(styles, /\.drawer-links[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/s);
  });
  it("hides the drawer and hamburger on desktop while HeaderView reuses the same items", () => {
    assert.match(styles, /@media \(min-width: 64rem\)\s*\{\s*\.hamburger-button, \.mobile-navigation\s*\{\s*display:\s*none/s);
    assert.match(header, /AUTHENTICATED_NAVIGATION/);
    assert.match(header, /new MobileNavigationDrawer\(items,/);
    assert.match(header, /items\.forEach\(\(item\) => desktopNav\.append/);
  });
});
