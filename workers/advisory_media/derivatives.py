"""Verified local JPEG views; this module performs no network or storage upload.

Overviews preserve aspect ratio and never upscale. Encoding tries quality 85 down
to 50 before reducing the longest edge, with a 1024-pixel floor (or the original
edge for smaller sources). It fails explicitly if that floor cannot fit the cap.
Detail boxes use EXIF-oriented source coordinates and retain their exact geometry.
Receipts contain relative filenames only. Native source bytes are never changed.
"""

from hashlib import sha256
from io import BytesIO
import os
from pathlib import Path
import re
import stat
from uuid import UUID

from PIL import Image, ImageOps, UnidentifiedImageError


MAX_SOURCE_BYTES = 200 * 1024 * 1024
MAX_SOURCE_PIXELS = 60_000_000
MAX_DERIVATIVE_BYTES = 768 * 1024
MAX_OVERVIEW_EDGE = 2048
MIN_OVERVIEW_EDGE = 1024
MAX_DETAIL_EDGE = 1024
JPEG_QUALITIES = tuple(range(85, 49, -5))


def _identity(source_sha256: str, source_asset_id: str, variant: str) -> dict:
    if not isinstance(source_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", source_sha256):
        raise ValueError("source_sha256 must be a lowercase SHA256 hex digest")
    if not isinstance(source_asset_id, str):
        raise ValueError("source_asset_id must be a UUID")
    try:
        asset_id = str(UUID(source_asset_id))
    except (ValueError, AttributeError) as error:
        raise ValueError("source_asset_id must be a UUID") from error
    if variant not in ("original", "combined"):
        raise ValueError("variant must be original or combined")
    return {"source_asset_id": asset_id, "variant": variant, "source_sha256": source_sha256}


def _reject_links(path: Path) -> None:
    # Check ancestors before resolve(), which would hide a symlink or junction.
    for part in (path, *path.parents):
        if part.is_symlink() or (hasattr(part, "is_junction") and part.is_junction()):
            raise ValueError("symlinks and junctions are not accepted")


def _new_output(path: Path) -> Path:
    path = Path(path).absolute()
    _reject_links(path)
    if path.exists():
        raise FileExistsError("output already exists")
    return path


def _read_verified(source_path: Path, expected_digest: str) -> bytes:
    path = Path(source_path).absolute()
    _reject_links(path)
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode):
        raise ValueError("source must be a regular file")
    if before.st_size > MAX_SOURCE_BYTES:
        raise ValueError("source exceeds byte limit")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as source:
        opened = os.fstat(source.fileno())
        if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise ValueError("source changed while opening")
        _reject_links(path)
        data = source.read(MAX_SOURCE_BYTES + 1)
    if len(data) > MAX_SOURCE_BYTES:
        raise ValueError("source exceeds byte limit")
    if sha256(data).hexdigest() != expected_digest:
        raise ValueError("source SHA256 does not match receipt")
    return data


def _load_rgb(data: bytes) -> Image.Image:
    try:
        with Image.open(BytesIO(data)) as source:
            if source.format not in ("JPEG", "PNG"):
                raise ValueError("only JPEG and PNG sources are accepted")
            width, height = source.size
            if width < 1 or height < 1 or width * height > MAX_SOURCE_PIXELS:
                raise ValueError("source exceeds pixel limit")
            if getattr(source, "n_frames", 1) != 1:
                raise ValueError("animated sources are not accepted")
            source.load()
            oriented = ImageOps.exif_transpose(source)
            # A fresh canvas strips all EXIF/GPS, XMP, ICC, text and thumbnails.
            clean = Image.new("RGB", oriented.size, "white")
            if oriented.mode in ("RGBA", "LA") or "transparency" in oriented.info:
                rgba = oriented.convert("RGBA")
                clean.paste(rgba, mask=rgba.getchannel("A"))
            else:
                clean.paste(oriented.convert("RGB"))
            return clean
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as error:
        raise ValueError("source is not a decodable safe JPEG or PNG") from error


def _encode(image: Image.Image, *, resize: bool) -> tuple[bytes, int, tuple[int, int]]:
    original_edge = max(image.size)
    initial_edge = min(original_edge, MAX_OVERVIEW_EDGE) if resize else original_edge
    minimum_edge = min(original_edge, MIN_OVERVIEW_EDGE) if resize else original_edge
    edges = [initial_edge]
    if resize:
        edges.extend(edge for edge in (1792, 1536, 1280, 1024) if minimum_edge <= edge < initial_edge)
    for edge in edges:
        if edge == original_edge:
            view = image
        else:
            size = tuple(max(1, round(dimension * edge / original_edge)) for dimension in image.size)
            view = image.resize(size, Image.Resampling.LANCZOS)
        try:
            for quality in JPEG_QUALITIES:
                buffer = BytesIO()
                view.save(buffer, "JPEG", quality=quality, subsampling=2, optimize=True, progressive=False)
                encoded = buffer.getvalue()
                if len(encoded) <= MAX_DERIVATIVE_BYTES:
                    return encoded, quality, view.size
        finally:
            if view is not image:
                view.close()
    raise ValueError("image cannot fit the byte cap within quality and geometry floors")


def _receipt(filename: str, data: bytes, quality: int, size: tuple[int, int]) -> dict:
    return {"file": filename, "sha256": sha256(data).hexdigest(), "bytes": len(data),
            "width": size[0], "height": size[1], "quality": quality}


def _write_new(path: Path, data: bytes) -> None:
    _reject_links(path)
    with path.open("xb") as output:
        try:
            output.write(data)
        except BaseException:
            output.close()
            path.unlink()
            raise


def build_derivatives(source_path: Path, output_dir: Path, *, source_sha256: str,
                      source_asset_id: str, variant: str) -> dict:
    """Create one new private-local overview directory and return its receipt.

    The parent directory must already exist. Existing output is always an error.
    Determinism applies to identical source bytes and the same Pillow/JPEG runtime.
    """
    identity = _identity(source_sha256, source_asset_id, variant)
    output_dir = _new_output(output_dir)
    data = _read_verified(source_path, source_sha256)
    with _load_rgb(data) as image:
        source_dimensions = {"width": image.width, "height": image.height}
        encoded, quality, size = _encode(image, resize=True)
    _reject_links(output_dir)
    output_dir.mkdir()
    try:
        _write_new(output_dir / "overview.jpg", encoded)
    except BaseException:
        # Only remove our newly created empty directory; never recursive cleanup.
        try:
            output_dir.rmdir()
        except OSError:
            pass
        raise
    return {"schema_version": "riceguard.advisory.derivative.v1", **identity,
            "source_dimensions": source_dimensions,
            "overview": _receipt("overview.jpg", encoded, quality, size)}


def build_detail_crop(source_path: Path, output_path: Path, *, source_sha256: str,
                      source_asset_id: str, variant: str, box: tuple[int, int, int, int]) -> dict:
    """Create one <=1024 x 1024 JPEG crop using oriented integer source bounds.

    Box is (left, top, right, bottom), with exclusive right/bottom bounds. Detail
    crops never resize: an unencodable crop fails instead of hiding lost detail.
    """
    identity = _identity(source_sha256, source_asset_id, variant)
    output_path = _new_output(output_path)
    if not isinstance(box, (tuple, list)) or len(box) != 4 or any(type(value) is not int for value in box):
        raise ValueError("box must contain four integer source coordinates")
    left, top, right, bottom = box
    if left < 0 or top < 0 or not 0 < right - left <= MAX_DETAIL_EDGE or not 0 < bottom - top <= MAX_DETAIL_EDGE:
        raise ValueError("box must be nonempty and at most 1024 by 1024")
    data = _read_verified(source_path, source_sha256)
    with _load_rgb(data) as image:
        source_dimensions = {"width": image.width, "height": image.height}
        if right > image.width or bottom > image.height:
            raise ValueError("box must be within the oriented source dimensions")
        with image.crop(box) as detail:
            encoded, quality, size = _encode(detail, resize=False)
    _write_new(output_path, encoded)
    return {"schema_version": "riceguard.advisory.detail.v1", **identity, "box": list(box),
            "source_dimensions": source_dimensions,
            "detail": _receipt(output_path.name, encoded, quality, size)}
