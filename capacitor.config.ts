import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.hush.mobile",
  appName: "Hush",
  webDir: "dist",
  backgroundColor: "#141517",
  server: { androidScheme: "https" },
  android: { allowMixedContent: false, minWebViewVersion: 119 },
  ios: { contentInset: "automatic", preferredContentMode: "mobile" },
  plugins: {
    Keyboard: { resize: "native", resizeOnFullScreen: true },
    SystemBars: { style: "DARK", initialViewportFitValueHint: "cover" },
  },
};
export default config;
