import { describe, expect, it } from "vitest";
import exifr from "exifr";
import { photoMetadataTags, validPhotoCoordinates, surveyPhotoLocation } from "./photoLocation";

// Minimal EXIF APP1 fixture with real TIFF GPS fields, without any field photograph.
function gpsExifFixture() {
  const tiff = new Uint8Array(128), view = new DataView(tiff.buffer);
  tiff.set([73, 73]); view.setUint16(2, 42, true); view.setUint32(4, 8, true);
  const tag = (offset: number, key: number, type: number, count: number, value: number) => {
    view.setUint16(offset, key, true); view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, count, true); view.setUint32(offset + 8, value, true);
  };
  view.setUint16(8, 1, true); tag(10, 0x8825, 4, 1, 26);
  view.setUint16(26, 4, true);
  tag(28, 1, 2, 2, 78); tag(40, 2, 5, 3, 80);
  tag(52, 3, 2, 2, 69); tag(64, 4, 5, 3, 104);
  [17, 25, 30, 121, 45, 0].forEach((value, index) => {
    view.setUint32(80 + index * 8, value, true); view.setUint32(84 + index * 8, 1, true);
  });
  const jpeg = new Uint8Array(142);
  jpeg.set([255, 216, 255, 225, 0, 136, 69, 120, 105, 102, 0, 0]);
  jpeg.set(tiff, 12); jpeg.set([255, 217], 140);
  return jpeg;
}
describe("EXIF auto-pin validation", () => {
  it("extracts actual EXIF GPS tags instead of filtering for derived coordinate names", async () => {
    const fixture = gpsExifFixture();
    const metadata = await exifr.parse(fixture, photoMetadataTags);
    const dedicatedGps = await exifr.gps(fixture);
    expect(validPhotoCoordinates(metadata.latitude, metadata.longitude)).toEqual(dedicatedGps);
    expect(metadata.latitude).toBeCloseTo(17.425);
    expect(metadata.longitude).toBeCloseTo(121.75);
    const legacy = await exifr.parse(fixture, ["latitude", "longitude"]);
    expect(validPhotoCoordinates(legacy?.latitude, legacy?.longitude)).toBeNull();
  });
  it("accepts native GPS and signed numeric XMP coordinates", () => {
    expect(validPhotoCoordinates(17.42, 121.76)).toEqual({ latitude: 17.42, longitude: 121.76 });
    expect(validPhotoCoordinates("-17.42", "121.76")).toEqual({ latitude: -17.42, longitude: 121.76 });
  });
  it("does not invent zero coordinates from missing, empty or partial metadata", () => {
    for (const [lat, lng] of [[null, null], [undefined, 121], ["", "121"], [true, 121], [0, 0], [91, 121], [17, Infinity]])
      expect(validPhotoCoordinates(lat, lng)).toBeNull();
  });
});

describe('one suggested survey location', () => {
  const photo = (id: number, lat?: number, lng?: number) => ({hash:String(id),kind:'image',gps:lat===undefined ? undefined : {latitude:lat,longitude:lng!}});
  it('averages all five nearby GPS photos, not the first one', () => {
    const result=surveyPhotoLocation([0,1,2,3,4].map(i=>photo(i,17.4+i*0.001,121.7+i*0.001)));
    expect(result.center?.lat).toBeCloseTo(17.402,8);expect(result.center?.lng).toBeCloseTo(121.702,8);
    expect(result.gpsCount).toBe(5);expect(result.spreadMeters).toBeGreaterThan(500);expect(result.requiresManualPin).toBe(false);
  });
  it('ignores missing GPS, video and exact duplicates without inventing coordinates', () => {
    const result=surveyPhotoLocation([photo(1,17.4,121.7),photo(1,17.4,121.7),photo(2),{...photo(3,18,122),kind:'video'}]);
    expect(result.photoCount).toBe(2);expect(result.gpsCount).toBe(1);expect(result.center?.lat).toBe(17.4);
    expect(surveyPhotoLocation([photo(1),photo(2)]).center).toBeNull();
  });
  it('requires a reviewed manual pin for widely separated points, retaining the spread', () => {
    const result=surveyPhotoLocation([photo(1,17.4,121.7),photo(2,18,122)]);
    expect(result.center).toBeNull();expect(result.requiresManualPin).toBe(true);expect(result.spreadMeters).toBeGreaterThan(1000);
  });
  it('recalculates the average after a photo is removed', () => {
    expect(surveyPhotoLocation([photo(1,17.4,121.7),photo(2,17.402,121.702)]).center?.lat).toBeCloseTo(17.401);
    expect(surveyPhotoLocation([photo(1,17.4,121.7)]).center?.lat).toBe(17.4);
  });
});
