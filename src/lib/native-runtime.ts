import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { cleanNativeExports, exportNativeBlob } from "./native-files";
import { supabase } from "./supabase";

export function validNativeLink(value: string) {
  return /^hush:\/\/(invite\/[a-f0-9]{48}|channel\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i.test(
    value,
  );
}

export async function initNativeRuntime() {
  if (!Capacitor.isNativePlatform()) return;
  const receive = (url: string) => {
    if (!validNativeLink(url)) return;
    sessionStorage.setItem("hush:pending-link", url.replace(/\/$/, ""));
    document.dispatchEvent(new Event("hush:link"));
  };
  await App.addListener("appUrlOpen", ({ url }) => receive(url));
  const launch = await App.getLaunchUrl();
  if (launch?.url) receive(launch.url);
  await App.addListener("backButton", async () => {
    const event = new Event("hush:back", { cancelable: true });
    if (document.dispatchEvent(event)) await App.minimizeApp();
  });
  await App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) supabase?.auth.startAutoRefresh();
    else supabase?.auth.stopAutoRefresh();
  });
  document.addEventListener(
    "click",
    (event) => {
      const anchor = (
        event.target as Element | null
      )?.closest<HTMLAnchorElement>("a[download]");
      if (!anchor || !anchor.href.startsWith("blob:")) return;
      event.preventDefault();
      void fetch(anchor.href)
        .then((r) => r.blob())
        .then((blob) => exportNativeBlob(blob, anchor.download || "allegato"))
        .catch(() => {
          document.dispatchEvent(
            new CustomEvent("hush:native-error", {
              detail: "Impossibile salvare o condividere il file.",
            }),
          );
        });
    },
    true,
  );
  void cleanNativeExports();
}
