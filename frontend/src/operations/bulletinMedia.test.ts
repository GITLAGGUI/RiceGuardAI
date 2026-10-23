import { describe, expect, it } from "vitest";
import { socialMosaicItems } from "./bulletinMedia";

const media = Array.from({ length: 11 }, (_, index) => ({
  url: `https://example.invalid/media-${index + 1}.jpg`,
  type: "image" as const,
}));

describe("social bulletin media mosaic", () => {
  it("shows five media tiles and reports the hidden remainder", () => {
    const result = socialMosaicItems(media);
    expect(result.visible).toHaveLength(5);
    expect(result.remaining).toBe(6);
    expect(result.visible.map((item) => item.url)).toEqual(media.slice(0, 5).map((item) => item.url));
  });

  it("does not add a remainder when every item is visible", () => {
    const result = socialMosaicItems(media.slice(0, 4));
    expect(result.visible).toHaveLength(4);
    expect(result.remaining).toBe(0);
  });
});
