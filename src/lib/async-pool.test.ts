import { expect, it } from "vitest";
import { mapConcurrent } from "./async-pool";

it("bounds simultaneous key work and preserves conversation ordering", async () => {
  let active = 0, peak = 0;
  const gates: Array<() => void> = [];
  const pending = mapConcurrent([0, 1, 2, 3, 4], 2, async value => {
    peak = Math.max(peak, ++active);
    await new Promise<void>(resolve => { gates[value] = resolve; });
    active--;
    return `room-${value}`;
  });
  expect(active).toBe(2);
  gates[1](); await Promise.resolve(); await Promise.resolve();
  expect(active).toBe(2);
  gates[2](); await Promise.resolve(); await Promise.resolve();
  gates[0](); await Promise.resolve(); await Promise.resolve();
  gates[4](); gates[3]();
  expect(await pending).toEqual(["room-0", "room-1", "room-2", "room-3", "room-4"]);
  expect(peak).toBe(2);
});

it("stops new work after failure and waits for work already started", async () => {
  const started: number[] = [];
  let release!: () => void;
  let finished = false;
  const pending = mapConcurrent([0, 1, 2], 2, async value => {
    started.push(value);
    if (value === 0) { await Promise.resolve(); throw new Error("Key unavailable"); }
    await new Promise<void>(resolve => { release = resolve; });
    finished = true;
    return value;
  });
  await Promise.resolve(); await Promise.resolve();
  expect(started).toEqual([0, 1]);
  release();
  await expect(pending).rejects.toThrow("Key unavailable");
  expect(finished).toBe(true);
});

it("does no work for an empty list and refuses unbounded concurrency", async () => {
  expect(await mapConcurrent([], 4, async () => 1)).toEqual([]);
  await expect(mapConcurrent([1], 0, async value => value)).rejects.toThrow();
});
