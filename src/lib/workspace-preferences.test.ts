import { expect, test } from "vitest";
import { sortWorkspaceItems, togglePreference } from "./workspace-preferences";
test("pin and favorite toggles do not create duplicates", () => {
  expect(togglePreference(["a"],"b")).toEqual(["a","b"]);
  expect(togglePreference(["a","b"],"a")).toEqual(["b"]);
});
test("manual ordering is stable for missing, new and stale items", () => {
  const items = [{id:"a"},{id:"b"},{id:"c"}];
  expect(sortWorkspaceItems(items,["deleted","b"]).map(item=>item.id)).toEqual(["b","a","c"]);
  expect(items.map(item=>item.id)).toEqual(["a","b","c"]);
});
