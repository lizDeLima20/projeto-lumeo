import type { CapacitorConfig } from "@capacitor/cli";

/** The Android shell consumes the same Vite build used by the PWA. */
const config: CapacitorConfig = {
  appId: "com.lumeo.reader",
  appName: "Lumeo",
  webDir: "dist",
  android: {
    allowMixedContent: false,
  },
};

export default config;
