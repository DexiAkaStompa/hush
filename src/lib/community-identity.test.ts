import { expect, test } from "vitest";
import {
  identityColor,
  safeCommunityImage,
  prepareCommunityImage,
} from "./community-identity";
test("community artwork accepts only bounded raster images", () => {
  expect(safeCommunityImage("data:image/webp;base64,UklGRg==")).toBeTruthy();
  for (const source of [
    "https://tracking.example/image.png",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/png;base64," + "A".repeat(131072),
  ])
    expect(safeCommunityImage(source)).toBeUndefined();
});
test("community colors cannot inject arbitrary CSS", () => {
  expect(identityColor("#abC123")).toBe("#abC123");
  expect(identityColor("red; background:url(example.com)")).toBe("#73b7ff");
});
test("invalid artwork is rejected before decoding", async () => {
  await expect(
    prepareCommunityImage(
      new File(["<svg/>"], "test.svg", { type: "image/svg+xml" }),
      "icon",
    ),
  ).rejects.toThrow("PNG");
});
