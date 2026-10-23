import json
import shutil
import subprocess

import pytest

from render_video_count import FRAME_COUNT, ass_document, ass_time, verified_frame_counts


def test_ass_has_bottom_only_count_and_exact_frame_times():
    text = ass_document({number: number % 3 for number in range(1, FRAME_COUNT + 1)})
    assert text.count("Dialogue: ") == FRAME_COUNT
    assert "Alignment" in text and "Shadow, Alignment" in text
    assert "Detected disease types: 1" in text
    assert "0:00:00.00,0:00:00.20" in text
    assert "0:00:30.80,0:00:31.00" in text
    assert ass_time(FRAME_COUNT) == "0:00:31.00"
    assert "BLB:" not in text and "Brown Spot:" not in text


def test_counts_require_all_verified_frames(tmp_path):
    path = tmp_path / "log.txt"
    frames = [{"frame": number, "time_seconds": round(104 + (number - 1) / 5, 3),
               "predicted_pixels": {"BLB": 0, "Brown Spot": 10}}
              for number in range(1, FRAME_COUNT + 1)]
    path.write_text(json.dumps({"status": "verified", "frames": frames}), encoding="utf-8")
    counts = verified_frame_counts(path)
    assert len(counts) == FRAME_COUNT and set(counts.values()) == {1}
    path.write_text(json.dumps({"status": "verified", "frames": frames[:-1]}), encoding="utf-8")
    with pytest.raises(ValueError, match="Only verified frames"):
        verified_frame_counts(path)


def test_ffmpeg_can_burn_ass_count_without_top_heading(tmp_path):
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg is unavailable")
    (tmp_path / "count.ass").write_text(
        ass_document({number: 2 for number in range(1, FRAME_COUNT + 1)}),
        encoding="utf-8",
    )
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
         "-i", "color=c=black:s=640x360:r=5", "-frames:v", "1", "-vf",
         "ass=count.ass", "-y", "count.png"],
        cwd=tmp_path, check=True,
    )
    assert (tmp_path / "count.png").stat().st_size > 0
