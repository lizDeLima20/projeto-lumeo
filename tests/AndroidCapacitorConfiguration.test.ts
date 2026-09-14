import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { EnvironmentConfig } from "../src/config/EnvironmentConfig";

describe("configuração Android Capacitor", () => {
  it("uses the production BFF when the Android build has its explicit public URL", () => {
    const config = new EnvironmentConfig({ MODE: "android", VITE_APP_ENV: "production", VITE_CAPACITOR_API_URL: "https://lumeo-livros.vercel.app/api/" } as ImportMetaEnv, () => true).read();
    assert.equal(config.bffBaseUrl, "https://lumeo-livros.vercel.app/api");
  });

  it("keeps the launcher callback scoped to the Lumeo custom scheme", async () => {
    const manifest = await readFile("android/app/src/main/AndroidManifest.xml", "utf8");
    assert.match(manifest, /android:scheme="com\.lumeo\.reader"/);
    assert.match(manifest, /android:host="auth"/);
    assert.match(manifest, /android:pathPrefix="\/callback"/);
  });

  it("uses the official frontend mark in the Android launcher resources", async () => {
    const source = await readFile("public/icons/icon-512.png");
    const icon = await readFile("android/app/src/main/res/mipmap-mdpi/ic_launcher.png");
    assert.deepEqual(icon, source);
  });

  it("keeps Android runtime diagnostics free of session and secret values", async () => {
    const diagnostics = await readFile("src/platform/AndroidRuntimeDiagnostics.ts", "utf8");
    assert.doesNotMatch(diagnostics, /accessToken|refreshToken|secretKey|authorization/i);
    assert.match(diagnostics, /LUMEO_ANDROID_BFF_READY/);
    assert.match(diagnostics, /JSON\.stringify/);
  });
});
