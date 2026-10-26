import { expect, test } from "vitest";
import { glassVector } from "./liquid-glass";
test("the clear center transmits light without displacement", () => {
  expect(glassVector(100,30,200,60,12,18)).toEqual([128,128]);
});
test("opposite edges bend the backdrop in opposite directions", () => {
  const left = glassVector(0,30,200,60,12,18), right = glassVector(200,30,200,60,12,18);
  expect(left[0]).toBeGreaterThan(128); expect(right[0]).toBeLessThan(128);
  expect(left[1]).toBe(128); expect(right[1]).toBe(128);
  expect(glassVector(100,0,200,60,12,18)[1]).toBeGreaterThan(128);
  expect(glassVector(100,60,200,60,12,18)[1]).toBeLessThan(128);
});
test("the circular bezel falloff disappears before reaching text", () => {
  expect(Math.abs(glassVector(3,30,200,60,12,18)[0]-128)).toBeGreaterThan(Math.abs(glassVector(12,30,200,60,12,18)[0]-128));
  expect(glassVector(20,30,200,60,12,18)).toEqual([128,128]);
});
