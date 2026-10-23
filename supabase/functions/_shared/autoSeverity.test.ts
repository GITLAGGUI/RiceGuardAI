import { assertEquals } from "jsr:@std/assert@1";
import { blbScore, brownSpotScore, computeSeverity, type PhotoInput } from "./autoSeverity.ts";

const photo = (id: string, index: number, plant: number, blb: number, spot: number, frame = 1_000_000): PhotoInput => ({
  source_asset_id: id, index, frame_pixels: frame, plant_pixels: plant,
  lesion_pixels: { BLB: blb, "Brown Spot": spot }, counted: { BLB: blb > 0, "Brown Spot": spot > 0 },
});

Deno.test("SES bands", () => {
  assertEquals([0, 0.4, 5, 5.1, 12, 13, 25, 26, 51].map(blbScore), [0, 1, 1, 3, 3, 5, 5, 7, 9]);
  assertEquals([0, 0.5, 1, 3, 4, 6, 11, 16, 26, 51, 80].map(brownSpotScore), [0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9]);
});

Deno.test("the most affected photo decides, not the average", () => {
  const detail = computeSeverity([
    photo("a", 0, 500_000, 5_000, 0),  // 1 %
    photo("b", 1, 400_000, 80_000, 0), // 20 % -> SES 5, moderate
    photo("c", 2, 600_000, 0, 0),
  ])!;
  assertEquals(detail.diseases.BLB!.representative_asset_id, "b");
  assertEquals(detail.diseases.BLB!.percent, 20);
  assertEquals(detail.diseases.BLB!.category, "moderate");
  assertEquals(detail.diseases.BLB!.affected_photos, 2);
  assertEquals(detail.overall, "moderate");
});

Deno.test("a sharper high-resolution photo does not win on raw pixels alone", () => {
  const detail = computeSeverity([
    photo("small", 0, 100_000, 20_000, 0, 200_000),         // 20 %
    photo("large", 1, 4_000_000, 300_000, 0, 8_000_000),    // 7.5 %, more pixels
  ])!;
  assertEquals(detail.diseases.BLB!.representative_asset_id, "small");
});

Deno.test("few detected pixels grade low; overall takes the worst disease", () => {
  const detail = computeSeverity([photo("a", 0, 500_000, 1_000, 90_000)])!;
  assertEquals(detail.diseases.BLB!.category, "low");
  assertEquals(detail.diseases["Brown Spot"]!.category, "high"); // 18 % -> SES 6
  assertEquals(detail.overall, "high");
});

Deno.test("rejected findings are ignored and soil-only photos are not representative", () => {
  const rejected = { ...photo("a", 0, 500_000, 100_000, 0), counted: { BLB: false, "Brown Spot": false } };
  assertEquals(computeSeverity([rejected]), null);
  const detail = computeSeverity([photo("soil", 0, 10_000, 5_000, 0), photo("field", 1, 500_000, 20_000, 0)])!;
  assertEquals(detail.diseases.BLB!.representative_asset_id, "field");
  assertEquals(detail.usable_photos, 1);
});
