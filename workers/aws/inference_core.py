"""Independent semantic masks. No leaf counts, disease exclusivity or severity."""
import math
from xml.etree import ElementTree

import cv2
import numpy as np
from PIL import Image, ImageOps

TILE = 1024
STRIDE = 768
MAX_PIXELS = 60_000_000
DISEASES = ("BLB", "Brown Spot")
DJI_XMP = "{http://www.dji.com/drone-dji/1.0/}"
TIFF_XMP = "{http://ns.adobe.com/tiff/1.0/}"


def axis_starts(length):
    if not isinstance(length, int) or length < 1:
        raise ValueError("Invalid image dimension")
    if length <= TILE:
        return [0]
    starts = list(range(0, length - TILE + 1, STRIDE))
    if starts[-1] != length - TILE:
        starts.append(length - TILE)
    return starts


def boxes_for(width, height):
    if width * height > MAX_PIXELS:
        raise ValueError("Image exceeds 60 MP limit")
    return [(x, y, min(x + TILE, width), min(y + TILE, height))
            for y in axis_starts(height) for x in axis_starts(width)]


def gps_coordinate(value, ref, valid_refs):
    if ref not in valid_refs or len(value) != 3:
        raise ValueError("Invalid GPS field")
    d, m, s = (float(n) for n in value)
    if not all(math.isfinite(n) for n in (d, m, s)) or not (d >= 0 and 0 <= m < 60 and 0 <= s < 60):
        raise ValueError("Invalid GPS field")
    return (d + m / 60 + s / 3600) * (-1 if ref in ("S", "W") else 1)


def dji_xmp_metadata(source):
    """Read only DJI's bounded photo-XMP metadata, never arbitrary XML fields."""
    raw = source.info.get("xmp")
    if not isinstance(raw, (bytes, str)) or not 0 < len(raw) <= 100_000:
        return None
    if b"<!DOCTYPE" in raw if isinstance(raw, bytes) else "<!DOCTYPE" in raw:
        return None
    try:
        root = ElementTree.fromstring(raw)
        descriptions = [node.attrib for node in root.iter() if node.tag.endswith("}Description")]
        if len(descriptions) != 1:
            return None
        values = descriptions[0]
        if values.get(TIFF_XMP + "Make", "").upper() != "DJI" or values.get(DJI_XMP + "GpsStatus") != "Normal":
            return None
        lat = float(values[DJI_XMP + "GpsLatitude"])
        lng = float(values[DJI_XMP + "GpsLongitude"])
        if not math.isfinite(lat) or not math.isfinite(lng) or abs(lat) > 90 or abs(lng) > 180 or (lat == 0 and lng == 0):
            return None
        return {"lat": lat, "lng": lng, "capture_time": values.get("{http://ns.adobe.com/xap/1.0/}CreateDate")}
    except (ElementTree.ParseError, KeyError, TypeError, ValueError):
        return None


def inspect_image(path):
    with Image.open(path) as source:
        # Some DJI .jpg files contain an MPF secondary picture, so Pillow
        # identifies the JPEG stream as MPO. The survey photo is frame zero.
        is_mpo = source.format == "MPO"
        if source.format not in ("JPEG", "PNG", "MPO"):
            raise ValueError("Expected a verified JPEG or PNG")
        if is_mpo:
            with open(path, "rb") as raw:
                if raw.read(3) != b"\xff\xd8\xff":
                    raise ValueError("MPO does not contain a JPEG primary image")
            source.seek(0)
        boxes_for(*source.size)
        exif = source.getexif()
        capture_time = exif.get_ifd(34665).get(36867) if 34665 in exif else None
        location = {"source": "missing", "lat": None, "lng": None}
        flags = ["mpo_primary_image_selected"] if is_mpo else []
        invalid_exif = False
        if 34853 in exif:
            gps = exif.get_ifd(34853)
            if all(field in gps for field in (1, 2, 3, 4)):
                try:
                    lat = gps_coordinate(gps[2], gps[1], ("N", "S"))
                    lng = gps_coordinate(gps[4], gps[3], ("E", "W"))
                    if abs(lat) > 90 or abs(lng) > 180:
                        raise ValueError("Invalid coordinates")
                    location = {"source": "exif", "lat": lat, "lng": lng}
                except (ValueError, TypeError, ZeroDivisionError):
                    invalid_exif = True
                    flags.append("invalid_gps_requires_manual_confirmation")
        xmp = dji_xmp_metadata(source)
        if xmp and location["source"] == "exif":
            if abs(location["lat"] - xmp["lat"]) > 0.0005 or abs(location["lng"] - xmp["lng"]) > 0.0005:
                location = {"source": "missing", "lat": None, "lng": None}
                flags.append("conflicting_gps_requires_manual_confirmation")
        elif xmp and not invalid_exif:
            location = {"source": "dji_xmp", "lat": xmp["lat"], "lng": xmp["lng"]}
            flags.append("dji_xmp_gps_used")
        if not capture_time and xmp:
            capture_time = xmp["capture_time"]
        if location["source"] == "missing":
            flags.append("no_verified_location")
        # Copy pixels only; derived files cannot inherit EXIF/GPS or comments.
        oriented = ImageOps.exif_transpose(source).convert("RGB")
        image = Image.fromarray(np.asarray(oriented).copy())
    return image, {"location": location, "capture_time": str(capture_time) if capture_time else None,
                   "capture_time_timezone": "unknown", "quality_flags": flags}


def stitch(image, predict, cache_get=None, cache_put=None, progress=None):
    boxes = boxes_for(*image.size)
    votes = np.zeros((image.height, image.width), dtype=np.uint8)
    coverage = np.zeros_like(votes)
    for index, (x1, y1, x2, y2) in enumerate(boxes):
        shape = (y2 - y1, x2 - x1)
        mask = cache_get(index, shape) if cache_get else None
        if mask is None:
            class_map = np.asarray(predict(image.crop((x1, y1, x2, y2))))
            if class_map.ndim != 2 or not np.isin(class_map, (0, 1)).all():
                raise ValueError("Unexpected semantic class map; refusing empty/invalid results")
            if class_map.shape != shape:
                class_map = cv2.resize(class_map.astype(np.uint8), (shape[1], shape[0]), interpolation=cv2.INTER_NEAREST)
            mask = class_map == 1
            if cache_put:
                cache_put(index, mask)
        if mask.shape != shape:
            raise ValueError("Checkpoint tile dimensions mismatch")
        votes[y1:y2, x1:x2] += mask.astype(np.uint8)
        coverage[y1:y2, x1:x2] += 1
        if progress:
            progress(index + 1, len(boxes))
    if not np.all(coverage):
        raise ValueError("Incomplete coverage")
    return votes * 2 >= coverage


def overlay(image, masks, alpha=0.42, *, show_boxes=True, show_outlines=True,
            minimum_box_pixels=1000):
    """Display-only regions; never modify masks or infer leaf counts/confidence."""
    rgb = np.asarray(image.convert("RGB")).copy()
    if not 0 <= alpha <= 1 or minimum_box_pixels < 1:
        raise ValueError("Invalid overlay display settings")
    colors = {"BLB": (255, 184, 0), "Brown Spot": (25, 180, 245)}
    selected = np.zeros(rgb.shape[:2], dtype=bool)
    color = np.zeros_like(rgb)
    checked = {}
    for disease, mask in masks.items():
        mask = np.asarray(mask)
        if disease not in colors or mask.shape != rgb.shape[:2] or not np.isin(mask, (0, 1)).all():
            raise ValueError("Unknown mask or wrong native dimensions")
        mask = mask.astype(bool)
        checked[disease] = mask
        selected |= mask
        color[mask] = colors[disease]
    if all(d in masks for d in DISEASES):
        color[checked["BLB"] & checked["Brown Spot"]] = (226, 75, 210)
    rgb[selected] = ((1 - alpha) * rgb[selected] + alpha * color[selected]).astype(np.uint8)
    height, width = rgb.shape[:2]
    thickness = max(1, round(min(width, height) / 600))
    font = max(0.45, min(width, height) / 1400)
    occupied = []
    # All contours remain visible, including regions below the box threshold.
    for disease in DISEASES:
        if disease not in checked:
            continue
        binary = checked[disease].astype(np.uint8)
        if show_outlines:
            contours, _ = cv2.findContours(binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(rgb, contours, -1, (12, 18, 24), thickness + 2)
            cv2.drawContours(rgb, contours, -1, colors[disease], thickness)
        if not show_boxes:
            continue
        _, _, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
        for x, y, box_width, box_height, area in sorted(stats[1:], key=lambda row: (-row[4], row[1], row[0])):
            if area < minimum_box_pixels:
                continue
            x, y, right, bottom = int(x), int(y), int(x + box_width - 1), int(y + box_height - 1)
            cv2.rectangle(rgb, (x, y), (right, bottom), (12, 18, 24), thickness + 2)
            cv2.rectangle(rgb, (x, y), (right, bottom), colors[disease], thickness)
            text = f"{disease} region"
            (tw, th), baseline = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font, thickness)
            if tw + 8 > width or th + baseline + 8 > height:
                continue
            left = min(x, width - tw - 8)
            label_height = th + baseline + 8
            bounds = None
            for top in (max(0, y - label_height), min(y + 3, height - label_height),
                        max(0, bottom - label_height)):
                candidate = (left, top, left + tw + 8, top + label_height)
                if not any(candidate[0] < old[2] and candidate[2] > old[0] and
                           candidate[1] < old[3] and candidate[3] > old[1] for old in occupied):
                    bounds = candidate
                    break
            if bounds is None:
                continue  # Keep the box; omit only colliding text.
            top = bounds[1]
            occupied.append(bounds)
            cv2.rectangle(rgb, bounds[:2], bounds[2:], (12, 18, 24), -1)
            cv2.putText(rgb, text, (left + 4, top + th + 4), cv2.FONT_HERSHEY_SIMPLEX,
                        font, colors[disease], thickness, cv2.LINE_AA)
    if show_boxes and selected.any():
        text = "Boxes: predicted regions, not leaf counts"
        (tw, th), baseline = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font, thickness)
        if tw + 12 <= width and th + baseline + 12 <= height:
            top = height - th - baseline - 12
            cv2.rectangle(rgb, (0, top), (tw + 12, height - 1), (12, 18, 24), -1)
            cv2.putText(rgb, text, (6, top + th + 4), cv2.FONT_HERSHEY_SIMPLEX,
                        font, (245, 248, 250), thickness, cv2.LINE_AA)
    return Image.fromarray(rgb)

