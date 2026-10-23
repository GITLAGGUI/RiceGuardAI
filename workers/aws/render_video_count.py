"""Burn a per-frame disease-type count onto the private 4K review video.

The two semantic specialists do not produce separate leaf instances. This
count is therefore the number of target disease types with nonempty masks,
never a count of affected leaves or lesions.
"""

import argparse
import json
from pathlib import Path
import subprocess

FRAME_COUNT = 155
FPS = 5
DISEASES = {"BLB", "Brown Spot"}


def verified_frame_counts(log_path):
    verified = {}
    for line in log_path.read_text(encoding="utf-8").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("status") != "verified" or not isinstance(event.get("frames"), list):
            continue
        for frame in event["frames"]:
            number = frame.get("frame")
            pixels = frame.get("predicted_pixels")
            if not isinstance(number, int) or not 1 <= number <= FRAME_COUNT:
                raise ValueError("Unexpected video frame number")
            if not isinstance(pixels, dict) or set(pixels) != DISEASES:
                raise ValueError("Video frame is missing a disease model")
            if any(not isinstance(value, int) or value < 0 for value in pixels.values()):
                raise ValueError("Invalid foreground pixel count")
            expected_time = 104 + (number - 1) / FPS
            if not isinstance(frame.get("time_seconds"), (int, float)) or abs(frame["time_seconds"] - expected_time) > 0.001:
                raise ValueError("Video frame timestamp is outside the selected interval")
            if number in verified and verified[number] != pixels:
                raise ValueError("Conflicting video frame receipts")
            verified[number] = pixels
    if set(verified) != set(range(1, FRAME_COUNT + 1)):
        missing = sorted(set(range(1, FRAME_COUNT + 1)) - set(verified))
        raise ValueError(f"Only verified frames can be rendered; missing {missing[:10]}")
    return {number: sum(value > 0 for value in verified[number].values())
            for number in range(1, FRAME_COUNT + 1)}


def ass_time(frame_offset):
    centiseconds = frame_offset * 100 // FPS
    hours, rem = divmod(centiseconds, 360000)
    minutes, rem = divmod(rem, 6000)
    seconds, hundredths = divmod(rem, 100)
    return f"{hours}:{minutes:02d}:{seconds:02d}.{hundredths:02d}"


def ass_document(counts):
    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 3840",
        "PlayResY: 2160",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Count,Arial,48,&H00FFFFFF,&H00FFFFFF,&H90000000,&H90000000,1,0,0,0,100,100,0,0,1,3,1,3,60,60,52,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for number in range(1, FRAME_COUNT + 1):
        lines.append(
            f"Dialogue: 0,{ass_time(number - 1)},{ass_time(number)},Count,,0,0,0,,"
            f"Detected disease types: {counts[number]}"
        )
    return "\n".join(lines) + "\n"


def probe_video(path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,nb_frames,duration", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    stream = json.loads(result.stdout)["streams"][0]
    if (stream["width"], stream["height"], int(stream["nb_frames"])) != (3840, 2160, FRAME_COUNT):
        raise ValueError("Video is not the verified 155-frame native-4K clip")
    if abs(float(stream["duration"]) - 31.0) > 0.01:
        raise ValueError("Video duration is not 31 seconds")


def render(input_video, log_path, output_video):
    if input_video.parent != output_video.parent:
        raise ValueError("Private count render must stay beside the verified source video")
    if output_video.exists():
        raise FileExistsError("Count-rendered video exists; refusing overwrite")
    probe_video(input_video)
    counts = verified_frame_counts(log_path)
    subtitle = output_video.with_suffix(".ass")
    if subtitle.exists():
        raise FileExistsError("Subtitle sidecar exists; refusing overwrite")
    subtitle.write_text(ass_document(counts), encoding="utf-8")
    try:
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", input_video.name,
             "-vf", f"ass={subtitle.name}", "-frames:v", str(FRAME_COUNT),
             "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
             "-movflags", "+faststart", "-an", output_video.name],
            cwd=input_video.parent, check=True,
        )
        probe_video(output_video)
    except Exception:
        # Preserve intermediate artifacts to diagnose a failed render.
        raise
    print(json.dumps({"status": "private_count_video_ready", "file": str(output_video),
                      "frames": FRAME_COUNT, "duration_seconds": 31,
                      "count_meaning": "disease types with nonempty semantic masks"}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    render(args.input.resolve(), args.log.resolve(), args.output.resolve())
