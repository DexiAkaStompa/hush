import { afterEach, expect, test, vi } from "vitest";
import { WindowControls } from "./WindowControls";

vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState: () => [false, vi.fn()],
  useEffect: () => undefined,
}));

afterEach(() => vi.unstubAllGlobals());
test("window buttons never forward React events across the Electron bridge", () => {
  const minimize = vi.fn(), toggleMaximize = vi.fn(), close = vi.fn();
  vi.stubGlobal("window", { hushWindow: { minimize, toggleMaximize, close } });
  const controls = WindowControls()!;
  const buttons = controls.props.children;
  // Real React click events contain functions/DOM objects that Electron cannot clone.
  const event = { preventDefault() {}, nativeEvent: { target: { dispatchEvent() {} } } };
  for (const button of buttons) button.props.onClick(event);
  expect(minimize).toHaveBeenCalledExactlyOnceWith();
  expect(toggleMaximize).toHaveBeenCalledExactlyOnceWith();
  expect(close).toHaveBeenCalledExactlyOnceWith();
});
test("window controls are absent when the desktop bridge is unavailable", () => {
  vi.stubGlobal("window", {});
  expect(WindowControls()).toBeNull();
});
