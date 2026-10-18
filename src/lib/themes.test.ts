import { afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const { supportsAcrylic } = createRequire(import.meta.url)("../../electron/window-material.cjs");
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

function harness(setMaterial?: (enabled: boolean) => Promise<boolean>, reduced = false) {
  const dataset: Record<string, string> = {};
  const listeners: Array<() => void> = [];
  const preference = { matches: reduced, addEventListener: (_: string, listener: () => void) => listeners.push(listener) };
  vi.stubGlobal("document", { documentElement: { dataset } });
  vi.stubGlobal("window", {
    localStorage: { setItem: vi.fn() },
    hushWindow: setMaterial ? { setMaterial } : undefined,
    matchMedia: (query: string) => query.includes("transparency") ? preference : { matches: false, addEventListener: vi.fn() },
  });
  return { dataset, preference, listeners };
}

test("acrylic requires Windows 11 22H2; other compositors use the fallback", () => {
  expect(supportsAcrylic("win32", "10.0.22621")).toBe(true);
  expect(supportsAcrylic("win32", "10.0.26200")).toBe(true);
  expect(supportsAcrylic("win32", "10.0.19045")).toBe(false);
  expect(supportsAcrylic("linux", "6.8.22621")).toBe(false);
});

test("glass remains opaque in browsers without a native material bridge", async () => {
  const h = harness();
  const { applyTheme } = await import("./themes");
  applyTheme("liquid-glass");
  expect(h.dataset.nativeGlass).toBeUndefined();
});

test("native transparency requires acknowledgement and ignores stale theme responses", async () => {
  let resolveGlass!: (value: boolean) => void;
  const material = vi.fn((enabled: boolean) => enabled ? new Promise<boolean>(resolve => { resolveGlass = resolve; }) : Promise.resolve(false));
  const h = harness(material);
  const { applyTheme } = await import("./themes");
  applyTheme("liquid-glass");
  expect(h.dataset.nativeGlass).toBeUndefined();
  applyTheme("hush-void");
  resolveGlass(true);
  await Promise.resolve();
  expect(h.dataset.nativeGlass).toBeUndefined();
  expect(material.mock.calls.map(([enabled]) => enabled)).toEqual([true, false]);
});

test("reduced transparency disables the native material and reacts to preference changes", async () => {
  const material = vi.fn(async (enabled: boolean) => enabled);
  const h = harness(material, true);
  const { applyTheme } = await import("./themes");
  applyTheme("liquid-glass");
  await Promise.resolve();
  expect(material).toHaveBeenLastCalledWith(false);
  h.preference.matches = false;
  h.listeners[0]();
  await Promise.resolve();
  expect(h.dataset.nativeGlass).toBe("true");
  h.preference.matches = true;
  h.listeners[0]();
  expect(h.dataset.nativeGlass).toBeUndefined();
});

test("native API errors preserve the readable fallback", async () => {
  const h = harness(async () => { throw new Error("unsupported compositor"); });
  const { applyTheme } = await import("./themes");
  applyTheme("frosted-glass");
  await Promise.resolve();
  await Promise.resolve();
  expect(h.dataset.nativeGlass).toBeUndefined();
});
