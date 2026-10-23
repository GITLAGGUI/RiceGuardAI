// Pick native TIFF GPS tags; latitude/longitude are derived AFTER these tags are parsed.
export const photoMetadataTags = ["Make", "Orientation", "GPSLatitude", "GPSLatitudeRef", "GPSLongitude", "GPSLongitudeRef", "DateTimeOriginal"];

export function validPhotoCoordinates(lat: unknown, lng: unknown) {
  const present = (value: unknown) => typeof value === "number" || (typeof value === "string" && value.trim() !== "");
  if (!present(lat) || !present(lng)) return null;
  const latitude = Number(lat), longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ||
    (latitude === 0 && longitude === 0)) return null;
  return { latitude, longitude };
}

type LocatedPhoto = { hash: string; kind: string; gps?: { latitude: number; longitude: number } };

/** A camera-position average is a suggestion, never a field boundary or GPS accuracy estimate. */
export function surveyPhotoLocation(files: LocatedPhoto[]) {
  const unique = [...new Map(files.filter(file => file.kind === "image").map(file => [file.hash, file])).values()];
  const points = unique.flatMap(file => {
    const point = validPhotoCoordinates(file.gps?.latitude, file.gps?.longitude);
    return point ? [point] : [];
  });
  if (!points.length) return { center: null, gpsCount: 0, photoCount: unique.length, spreadMeters: 0, requiresManualPin: true };
  const lat = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const radians = (value: number) => value * Math.PI / 180;
  // Circular longitude mean also avoids a false midpoint across the dateline.
  const lng = Math.atan2(points.reduce((sum, point) => sum + Math.sin(radians(point.longitude)), 0),
    points.reduce((sum, point) => sum + Math.cos(radians(point.longitude)), 0)) * 180 / Math.PI;
  let spreadMeters = 0;
  for (const a of points) for (const b of points) {
    const h = Math.sin(radians(b.latitude - a.latitude) / 2) ** 2 +
      Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
    spreadMeters = Math.max(spreadMeters, 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h))));
  }
  // Conservative review guard, not a claim about field size. Never silently
  // discard an outlier or treat separated captures as one verified field.
  const requiresManualPin = spreadMeters > 1000;
  return { center: requiresManualPin ? null : { lat, lng }, gpsCount: points.length, photoCount: unique.length, spreadMeters, requiresManualPin };
}
