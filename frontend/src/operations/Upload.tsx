import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  UploadCloud,
  CheckCircle2,
  CircleAlert,
  MapPin,
  ZoomIn,
  ZoomOut,
  Eye,
  FileImage,
  ChevronLeft,
  ChevronRight,
  Play,
} from "lucide-react";
import * as exifr from "exifr";
import { createMD5, createSHA256 } from "hash-wasm";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { FieldMap } from "./Map";
import { useOperations, operation } from "./store";
import { ReviewJourney } from "./ReviewJourney";
import { currentSeverityBulletin } from "./severityPresentation";
import { fieldSeverityForSurvey, fieldSeverityLabel } from "./severityPresentation";
import { validatePrediction, type Prediction } from "./domain";
import { findInterruptedSurveyMatch, findResumableSurvey } from "./uploadRecovery";
import { photoMetadataTags, validPhotoCoordinates, surveyPhotoLocation } from "./photoLocation";
interface UploadFile {
  id: string;
  file: File;
  hash: string;
  md5: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  orientation: number;
  mime: string;
  kind: "image" | "video" | "sidecar";
  gps?: { latitude: number; longitude: number };
  gpsSource?: "exif" | "dji_xmp";
  make?: string;
  takenAt?: string;
  clipStart: number;
  clipDuration: number;
  linkedPhotoLocalId: string;
  status: string;
  progress: number;
}
async function fileHashes(file: File) {
  const sha = await createSHA256();
  const md5 = await createMD5();
  const chunk = 8 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += chunk) {
    const bytes = new Uint8Array(await file.slice(offset, offset + chunk).arrayBuffer());
    sha.update(bytes);
    md5.update(bytes);
  }
  return { sha256: sha.digest(), md5: md5.digest() };
}
async function videoMetadata(file: File) {
  return new Promise<{ width: number; height: number; duration: number }>((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const result = { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name}: invalid MP4 metadata.`)); };
    video.src = url;
  });
}

function normalizeExifOrientation(value: unknown) {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 8) return numeric;
  const label = String(value || "").trim().toLowerCase();
  const labels: Record<string, number> = {
    "horizontal (normal)": 1,
    "mirror horizontal": 2,
    "rotate 180": 3,
    "mirror vertical": 4,
    "mirror horizontal and rotate 270 cw": 5,
    "rotate 90 cw": 6,
    "mirror horizontal and rotate 90 cw": 7,
    "rotate 270 cw": 8,
  };
  return labels[label] || 1;
}

async function inspect(file: File): Promise<UploadFile> {
  if (file.size > 5 * 1024 * 1024 * 1024)
    throw new Error(`${file.name}: exceeds the 5 GB application limit.`);
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  const mp4 = String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
  const extension = file.name.split(".").pop()?.toLowerCase();
  const sidecar = ["srt", "csv", "json"].includes(extension || "");
  if (!jpeg && !png && !mp4 && !sidecar)
    throw new Error(`${file.name}: unsupported or invalid media signature.`);
  const kind = jpeg || png ? "image" : mp4 ? "video" : "sidecar";
  let width: number | null = null;
  let height: number | null = null;
  let duration: number | null = null;
  let meta: Record<string, unknown> | null = null;
  let gps: UploadFile["gps"];
  let gpsSource: UploadFile["gpsSource"];
  if (kind === "image") {
    const bitmap = await createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
    if (width < 512 || height < 512 || width > 30000 || height > 30000)
      throw new Error(`${file.name}: unsupported image dimensions.`);
    meta = await exifr.parse(file, photoMetadataTags).catch(() => null);
    const exifPoint = validPhotoCoordinates(meta?.latitude, meta?.longitude);
    if (exifPoint) {
      gps = exifPoint;
      gpsSource = "exif";
    }
    if (jpeg) {
      const xmp = await exifr.parse(file, { tiff: false, xmp: true }).catch(() => null) as Record<string, unknown> | null;
      const xmpPoint = validPhotoCoordinates(xmp?.GpsLatitude, xmp?.GpsLongitude);
      const xmpLat = xmpPoint?.latitude || 0, xmpLng = xmpPoint?.longitude || 0;
      const validDjiGps = String(xmp?.Make || meta?.Make || "").trim().toUpperCase() === "DJI" && xmp?.GpsStatus === "Normal" && Boolean(xmpPoint);
      if (validDjiGps && gps &&
        (Math.abs(gps.latitude - xmpLat) > 0.0005 || Math.abs(gps.longitude - xmpLng) > 0.0005)) {
        gps = undefined;
        gpsSource = undefined;
      } else if (validDjiGps && !gps) {
        gps = { latitude: xmpLat, longitude: xmpLng };
        gpsSource = "dji_xmp";
      }
    }
  } else if (kind === "video") {
    const video = await videoMetadata(file);
    width = video.width;
    height = video.height;
    duration = video.duration;
  }
  const hashes = await fileHashes(file);
  const mime = file.type || (extension === "srt" ? "application/x-subrip" : extension === "csv" ? "text/csv" : "application/json");
  return {
    id: crypto.randomUUID(),
    file,
    hash: hashes.sha256,
    md5: hashes.md5,
    width,
    height,
    duration,
    orientation: normalizeExifOrientation(meta?.Orientation),
    make: typeof meta?.Make === "string" ? meta.Make.trim() : undefined,
    takenAt: meta?.DateTimeOriginal instanceof Date && !Number.isNaN(meta.DateTimeOriginal.getTime())
      ? meta.DateTimeOriginal.toISOString() : undefined,
    mime,
    kind,
    gps,
    gpsSource,
    clipStart: 0,
    clipDuration: kind === "video" ? Math.min(30, Math.floor((duration || 0) * 30) / 30) : 0,
    linkedPhotoLocalId: "",
    status: "Validated locally",
    progress: 0,
  };
}

type UploadIntent = {
  asset_id: string;
  upload_url?: string;
  required_headers?: Record<string, string>;
  already_verified?: boolean;
};

type UploadRecovery = {
  recovered?: boolean;
};

const pause = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function uploadToDrive(file: File, intent: UploadIntent, onProgress: (percent: number) => void) {
  if (!intent.upload_url) return Promise.reject(new Error("Upload session is unavailable"));
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", intent.upload_url!);
    xhr.timeout = 30 * 60 * 1000;
    Object.entries(intent.required_headers || {}).forEach(([key, value]) =>
      xhr.setRequestHeader(key, String(value)),
    );
    xhr.upload.onprogress = (progress) => {
      if (progress.lengthComputable) onProgress(Math.round((progress.loaded / progress.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Drive upload failed with HTTP ${xhr.status}`));
        return;
      }
      try {
        const result = JSON.parse(xhr.responseText);
        if (!result.id) throw new Error("Drive did not return a file identifier");
        resolve(result.id);
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => reject(new Error("Network interrupted the Drive upload"));
    xhr.ontimeout = () => reject(new Error("Drive upload timed out"));
    xhr.send(file);
  });
}

export function UploadWorkspace() {
  const { demo, data, addSurvey, refresh } = useOperations();
  const navigate = useNavigate();
  const awsPhotoEnabled = import.meta.env.VITE_AWS_PHOTO_PILOT_ENABLED === "true";
  const pinnedMediaEnabled = import.meta.env.VITE_PINNED_KAGGLE_UPLOAD_ENABLED === "true";
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [pinSource, setPinSource] = useState<"photo_average" | "manual" | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [camera, setCamera] = useState("auto");
  const photoLocation = useMemo(() => surveyPhotoLocation(files), [files]);
  // Every photo carries GPS (and they sit within 1 km): the pin is set for you.
  // One photo without GPS is enough to ask for a manual pin.
  const autoLocation = photoLocation.photoCount > 0 && photoLocation.gpsCount === photoLocation.photoCount && photoLocation.center
    ? photoLocation.center : null;
  const previousPhotoSelection = useRef("");
  useEffect(() => {
    const selection = files.map(file => file.hash).join(":");
    if (previousPhotoSelection.current === selection) return;
    previousPhotoSelection.current = selection;
    if (autoLocation) {
      setPin(autoLocation);
      setPinSource("photo_average");
    } else if (pinSource !== "manual") {
      setPin(null);
      setPinSource(null);
    }
  }, [files, autoLocation, pinSource]);
  useEffect(() => {
    setPlace(null);
    if (!pin || demo) return;
    let cancelled = false;
    void supabase.rpc("rg_reverse_geocode", { p_lat: pin.lat, p_lng: pin.lng }).then(({ data: found }) => {
      if (!cancelled) setPlace(found?.label || (found?.method === "outside_region" ? "Labas sa Region II" : null));
    });
    return () => { cancelled = true; };
  }, [pin, demo]);
  const detectedCamera = useMemo(() => {
    const makes = [...new Set(files.map((file) => file.make).filter(Boolean))];
    return makes.length ? makes.join(" / ") : null;
  }, [files]);
  const takenAt = useMemo(() => files.map((file) => file.takenAt).filter(Boolean).sort()[0] || null, [files]);
  const base = demo ? "/demo" : "/admin";
  const resumableSurvey = useMemo(() => findResumableSurvey(
    data.surveys,
    data.assets,
    files.map((file) => file.hash),
  ), [data.assets, data.surveys, files]);
  const resumableAssets = useMemo(() => resumableSurvey
    ? data.assets.filter((asset) => asset.survey_id === resumableSurvey.id)
    : [], [data.assets, resumableSurvey]);
  const interruptedMatch = useMemo(() => findInterruptedSurveyMatch(
    data.surveys,
    data.assets,
    files.map((file) => file.hash),
  ), [data.assets, data.surveys, files]);
  useEffect(() => {
    if (!busy || demo) return;
    const protectUpload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUpload);
    return () => window.removeEventListener("beforeunload", protectUpload);
  }, [busy, demo]);
  const choose = async (selected: FileList | File[]) => {
    if (busy) return;
    const maximum = demo ? 250 : pinnedMediaEnabled ? 11 : 4;
    if (files.length + selected.length > maximum) {
      toast.error(`Maximum ${maximum} files per batch.`);
      return;
    }
    setBusy(true);
    const next = [...files];
    const failures: string[] = [];
    try {
      for (const f of Array.from(selected)) {
        try {
          const record = await inspect(f);
          const invalidPhoto = record.kind === "image" && (record.file.size > 200_000_000 ||
            record.width == null || record.height == null || record.width * record.height > 60_000_000);
          const invalidVideo = record.kind === "video" && (!pinnedMediaEnabled || record.width == null ||
            record.height == null || record.width * record.height > 60_000_000 || record.duration == null || record.duration <= 0);
          if (!demo && (record.kind === "sidecar" || invalidPhoto || invalidVideo)) {
            failures.push(`${f.name}: live processing accepts 1–10 JPEG/PNG photos and, when enabled, one MP4 clip linked to a photo.`);
            continue;
          }
          if (!demo && record.kind === "video" && next.some((item) => item.kind === "video")) {
            failures.push(`${f.name}: only one presentation video is allowed per survey.`);
            continue;
          }
          if (next.some((x) => x.hash === record.hash)) {
            failures.push(`${f.name}: exact duplicate skipped.`);
            continue;
          }
          next.push(record);
        } catch (e) {
          failures.push((e as Error).message);
        }
      }
      const firstPhoto = next.find((item) => item.kind === "image");
      const prepared = next.map((item) => item.kind === "video" && !item.linkedPhotoLocalId && firstPhoto
        ? { ...item, linkedPhotoLocalId: firstPhoto.id }
        : item);
      setFiles(prepared);
      setErrors(failures);
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!files.length || (!resumableSurvey && !pin)) return;
    const photos = files.filter((item) => item.kind === "image");
    const videos = files.filter((item) => item.kind === "video");
    const eligiblePhotos = photos.length >= 1 && photos.length <= 4 && files.length === photos.length && files.every((item) =>
      item.kind === "image" && item.file.size <= 200_000_000 &&
      item.width != null && item.height != null && item.width * item.height <= 60_000_000);
    const eligiblePinned = photos.length >= 1 && photos.length <= 10 && videos.length <= 1 &&
      photos.length + videos.length === files.length && photos.every((item) => item.file.size <= 200_000_000 &&
        item.width != null && item.height != null && item.width * item.height <= 60_000_000) &&
      videos.every((item) => item.duration != null && item.clipStart >= 0 && item.clipDuration > 0 &&
        item.clipDuration <= 30 && item.clipStart + item.clipDuration <= item.duration + 0.01 &&
        Math.abs(item.clipDuration * 30 - Math.round(item.clipDuration * 30)) <= 0.01 &&
        photos.some((photo) => photo.id === item.linkedPhotoLocalId));
    if (!demo && !awsPhotoEnabled && !pinnedMediaEnabled) {
      toast.error("Private dual-model website processing is not active yet. Your files remain on this device.");
      return;
    }
    if (!demo && pinnedMediaEnabled && !eligiblePinned) {
      toast.error("Add 1–10 valid photos. An optional video needs a 30 FPS-aligned clip up to 30 seconds and a linked GPS-reference photo.");
      return;
    }
    if (!demo && !pinnedMediaEnabled && awsPhotoEnabled && !eligiblePhotos) {
      toast.error("Private dual-model photo processing accepts 1–4 JPEG/PNG photos up to 60 MP and 200 MB each.");
      return;
    }
    const form = new FormData(e.currentTarget);
    if (!resumableSurvey && interruptedMatch) {
      const expected = interruptedMatch.expected_assets || interruptedMatch.photos;
      toast.error(`These files belong to interrupted survey “${interruptedMatch.name}”. Select all ${expected} original files together to resume it without a duplicate.`);
      return;
    }
    const id = resumableSurvey?.id || crypto.randomUUID();
    const capturedAt = resumableSurvey?.captured_at || takenAt || new Date().toISOString();
    const cameraLabel = resumableSurvey?.camera || (camera === "auto" ? detectedCamera || "Hindi natukoy"
      : camera === "other" ? String(form.get("camera_other") || "Iba pa").trim() : camera);
    const surveyName = String(form.get("name") || "").trim() ||
      `${(place || "Rice field").replace(/^Brgy\. /, "")} · ${new Date(capturedAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}`;
    setBusy(true);
    try {
      if (!resumableSurvey) {
        await addSurvey({
          id,
          ...(!demo ? { inference_provider: pinnedMediaEnabled ? "kaggle_yolo26" as const : "aws" as const } : {}),
          name: surveyName.slice(0, 160),
          location: place || "",
          captured_at: capturedAt,
          camera: cameraLabel.slice(0, 120),
          status: "Awaiting upload",
          photos: files.length,
          expected_assets: files.length,
          severity: "not_calibrated",
          lat: pin?.lat ?? null,
          lng: pin?.lng ?? null,
          location_status: pin ? "verified" : "missing",
          location_source: pinSource === "manual" ? "manual_pin" : pin ? "exif_median" : "none",
          crop_stage: String(form.get("crop_stage") || "unknown") as "unknown" | "seedling" | "vegetative" | "reproductive" | "ripening" | "post_harvest",
          field_conditions: form.getAll("field_conditions").map(String) as ("standing_water" | "lodging" | "dry_or_cracked_soil" | "nutrient_stress_suspected" | "pest_damage_suspected")[],
        });
      }
      if (demo) {
        toast.success(
          "Demo survey created. Original files stayed on this device; no inference ran.",
        );
        return;
      }
      const serverAssetIds = new Map<string, string>();
      const uploadOrder = [...photos, ...videos];
      const existingByChecksum = new Map(resumableAssets.map((asset) => [asset.checksum, asset]));
      for (const photo of photos) {
        const existing = existingByChecksum.get(photo.hash);
        if (existing?.status === "Verified") serverAssetIds.set(photo.id, existing.id);
      }
      const failures: string[] = [];
      for (const f of uploadOrder) {
        const existing = existingByChecksum.get(f.hash);
        if (existing?.status === "Verified") {
          serverAssetIds.set(f.id, existing.id);
          setFiles((current) => current.map((item) => item.id === f.id
            ? { ...item, progress: 100, status: "Already verified" } : item));
          continue;
        }
        let assetId = existing?.id || "";
        let lastError = "Upload failed";
        let complete = false;
        for (let attempt = 1; attempt <= 3 && !complete; attempt += 1) {
          try {
            if (assetId) {
              const recovery = await operation("recover-upload", { asset_id: assetId }) as UploadRecovery;
              if (recovery.recovered) {
                complete = true;
                break;
              }
            }
            setFiles((current) => current.map((item) => item.id === f.id
              ? { ...item, status: `${existing || assetId ? "Resuming" : "Uploading"} · attempt ${attempt}/3` }
              : item));
            const payload = {
              flight_id: id,
              captured_at: capturedAt,
              camera_id: camera,
              width: f.width,
              height: f.height,
              checksum: f.hash,
              md5_checksum: f.md5,
              bytes: f.file.size,
              content_type: f.mime,
              orientation: f.orientation,
              filename: f.file.name,
              duration_seconds: f.duration,
              ...(f.kind === "video" ? {
                clip_start_seconds: f.clipStart,
                clip_duration_seconds: f.clipDuration,
                clip_target_fps: 30,
                linked_photo_asset_id: serverAssetIds.get(f.linkedPhotoLocalId),
              } : {}),
              exif_lat: f.gpsSource === "exif" ? f.gps?.latitude : undefined,
              exif_lng: f.gpsSource === "exif" ? f.gps?.longitude : undefined,
            };
            const intent = await operation(existing || assetId ? "resume-upload-intent" : "upload-intent", payload) as UploadIntent;
            assetId = intent.asset_id;
            if (intent.already_verified) {
              complete = true;
            } else {
              const driveFileId = await uploadToDrive(f.file, intent, (percent) =>
                setFiles((current) => current.map((item) => item.id === f.id
                  ? { ...item, progress: percent, status: `Uploading · ${percent}%` } : item)),
              );
              let verified = false;
              for (let verificationAttempt = 1; verificationAttempt <= 3 && !verified; verificationAttempt += 1) {
                try {
                  await operation("upload-complete", { asset_id: assetId, drive_file_id: driveFileId });
                  verified = true;
                } catch (error) {
                  if (verificationAttempt === 3) throw error;
                  await pause(verificationAttempt * 1500);
                }
              }
              complete = verified;
            }
          } catch (error) {
            lastError = (error as Error).message;
            if (assetId) {
              try {
                const recovery = await operation("recover-upload", { asset_id: assetId }) as UploadRecovery;
                if (recovery.recovered) {
                  complete = true;
                  break;
                }
              } catch {
                // The ordinary retry path remains available when Drive has no complete file yet.
              }
            }
            if (attempt < 3) await pause(attempt * 2000);
          }
        }
        if (complete) {
          serverAssetIds.set(f.id, assetId);
          setFiles((current) => current.map((item) => item.id === f.id
            ? { ...item, progress: 100, status: "Verified" } : item));
        } else {
          failures.push(`${f.file.name}: ${lastError}`);
          setFiles((current) => current.map((item) => item.id === f.id
            ? { ...item, status: `${lastError}. Reselect this exact batch to resume.` } : item));
          if (assetId) {
            await operation("upload-failed", { asset_id: assetId, error: lastError }).catch(() => undefined);
          }
        }
      }
      await refresh();
      if (failures.length) {
        setErrors(failures);
        toast.error(`${failures.length} file${failures.length === 1 ? "" : "s"} paused. Reselect the exact batch to resume without duplicating the survey.`);
      } else {
        setErrors([]);
        toast.success(`All ${files.length} originals are verified. The private processing job is now queued.`);
        navigate(`${base}/surveys`, { replace: true });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="rg-page-heading">
        <div>
          <div className="rg-eyebrow">UPLOAD → AUTOMATIC ADVISORY</div>
          <h1>Bagong survey</h1>
          <p>
            {demo
              ? "Explore photo, video, and DJI telemetry validation with local demo files. No model inference runs in demo mode."
              : pinnedMediaEnabled
                ? "Upload 1–10 original photos and one optional MP4. Select a clip up to 30 seconds at 30 FPS and link it to a survey photo."
              : awsPhotoEnabled
                ? "Upload 1–4 original JPEG/PNG photos. Missing GPS does not block image analysis; staff must confirm location before publication."
                : "Private survey processing is not enabled on this website yet. Files selected here stay on this device."}
          </p>
        </div>
        <Link to={`${base}/surveys`} className="rg-button rg-secondary" aria-disabled={busy}
          onClick={(event) => {
            if (!busy) return;
            event.preventDefault();
            toast.error("Keep this page open while originals are uploading. The batch can be resumed after an interruption.");
          }}>
          All surveys
        </Link>
      </div>
      <form className="rg-upload-grid" onSubmit={submit}>
        <section className="rg-panel rg-form">
          {resumableSurvey ? (
            <div className="rg-notice rg-warning" role="status">
              <CheckCircle2 size={18} />
              <div>
                <strong>Interrupted upload matched safely</strong>
                <p>{resumableSurvey.name}: {resumableAssets.filter((asset) => asset.status === "Verified").length} of {resumableSurvey.expected_assets} originals verified. Submit to resume this same survey; no duplicate record will be created.</p>
              </div>
            </div>
          ) : null}
          <h2>1 · Mga larawan</h2>
          <label
            className="rg-dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void choose(e.dataTransfer.files);
            }}
          >
            <UploadCloud size={32} />
            <strong>{busy ? "Inihahanda ang mga larawan…" : "I-drop dito ang mga larawan ng palayan"}</strong>
            <span>{pinnedMediaEnabled ? "o i-tap para pumili · 1–10 JPEG/PNG + isang MP4 (opsyonal)" : "o i-tap para pumili · JPEG / PNG"}</span>
            <input
              type="file"
              accept={demo || pinnedMediaEnabled ? "image/jpeg,image/png,video/mp4" : "image/jpeg,image/png"}
              multiple
              disabled={busy}
              onChange={(e) => {
                if (e.target.files) void choose(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          {errors.length > 0 && (
            <div className="rg-notice rg-warning" role="alert">
              <div>
                {errors.map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
              </div>
            </div>
          )}
          <div className="rg-upload-files" aria-live="polite">
            {files.map((f) => (
              <div key={f.id}>
                <FileImage size={20} />
                <span>
                  <strong>{f.file.name}</strong>
                  <small>
                    {f.width && f.height ? `${f.width} × ${f.height} · ` : ""}
                    {(f.file.size / 1048576).toFixed(1)} MB · {f.kind === "video" ? "video" : f.gps ? "may GPS" : "walang GPS"}
                  </small>
                  <small>{f.status}</small>
                  {!demo && pinnedMediaEnabled && f.kind === "video" ? (
                    <div className="rg-form-grid">
                      <label>
                        Simula ng clip (segundo)
                        <input type="number" min={0} max={Math.max(0, (f.duration || 0) - 1 / 30)} step={1 / 30}
                          value={f.clipStart} disabled={busy}
                          onChange={(event) => setFiles((current) => current.map((item) => item.id === f.id
                            ? { ...item, clipStart: Number(event.target.value) } : item))} />
                      </label>
                      <label>
                        Haba ng clip (max 30 s)
                        <input type="number" min={1 / 30} max={Math.min(30, Math.max(1 / 30, (f.duration || 0) - f.clipStart))}
                          step={1 / 30} value={f.clipDuration} disabled={busy}
                          onChange={(event) => setFiles((current) => current.map((item) => item.id === f.id
                            ? { ...item, clipDuration: Number(event.target.value) } : item))} />
                      </label>
                      <label>
                        Larawang kasama ng video
                        <select value={f.linkedPhotoLocalId} required disabled={busy}
                          onChange={(event) => setFiles((current) => current.map((item) => item.id === f.id
                            ? { ...item, linkedPhotoLocalId: event.target.value } : item))}>
                          <option value="">Unang larawan (auto)</option>
                          {files.filter((item) => item.kind === "image").map((photo) =>
                            <option key={photo.id} value={photo.id}>{photo.file.name}</option>)}
                        </select>
                      </label>
                    </div>
                  ) : null}
                  {f.progress > 0 ? (
                    <progress aria-label={`Upload progress for ${f.file.name}`} value={f.progress} max={100} />
                  ) : null}
                </span>
                <button
                  type="button"
                  className="rg-icon-button"
                  aria-label={`Remove ${f.file.name}`}
                  disabled={busy}
                  onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <details className="rg-upload-details">
            <summary>3 · Detalye (opsyonal)</summary>
            <div className="rg-form-grid">
              <label>
                Pangalan ng survey
                <input name="name" placeholder={place ? `${place.replace(/^Brgy\. /, "")} · ngayon` : "Awtomatiko kung blangko"} maxLength={160} />
              </label>
              <label>
                Camera
                <select value={camera} onChange={(event) => setCamera(event.target.value)}>
                  <option value="auto">{detectedCamera ? `Auto: ${detectedCamera}` : "Auto (mula sa larawan)"}</option>
                  <option value="DJI drone">DJI drone</option>
                  <option value="Cellphone">Cellphone</option>
                  <option value="other">Iba pa (pakisulat)</option>
                </select>
              </label>
              {camera === "other" ? (
                <label>
                  Anong camera?
                  <input name="camera_other" required maxLength={120} placeholder="hal. Canon EOS" />
                </label>
              ) : null}
              <label>
                Yugto ng palay
                <select name="crop_stage" defaultValue="unknown">
                  <option value="unknown">Hindi sigurado</option>
                  <option value="seedling">Punla (seedling)</option>
                  <option value="vegetative">Nag-uusbong / tillering</option>
                  <option value="reproductive">Nagbubuntis / heading</option>
                  <option value="ripening">Nahihinog</option>
                  <option value="post_harvest">Tapos na ang ani</option>
                </select>
              </label>
            </div>
            <fieldset className="rg-field-conditions">
              <legend>Kalagayan ng bukid (lagyan ng check kung meron)</legend>
              <label className="rg-check"><input type="checkbox" name="field_conditions" value="standing_water" />Nakababad sa tubig / baha</label>
              <label className="rg-check"><input type="checkbox" name="field_conditions" value="lodging" />Nakadapa ang palay</label>
              <label className="rg-check"><input type="checkbox" name="field_conditions" value="dry_or_cracked_soil" />Tuyo o bitak ang lupa</label>
              <label className="rg-check"><input type="checkbox" name="field_conditions" value="nutrient_stress_suspected" />Mukhang kulang sa abono</label>
              <label className="rg-check"><input type="checkbox" name="field_conditions" value="pest_damage_suspected" />May sira ng peste o hayop</label>
            </fieldset>
          </details>
        </section>
        <aside className="rg-panel rg-form">
          <h2>2 · Lokasyon ng bukid</h2>
          {!files.length ? (
            <p className="rg-muted">Pumili muna ng larawan. Kapag lahat ay may GPS, kusa nang ilalagay ang pin.</p>
          ) : autoLocation && pinSource === "photo_average" ? (
            <div className="rg-notice rg-success" role="status">
              <CheckCircle2 size={18} />
              <div>
                <strong>Awtomatiko ang lokasyon</strong>
                <p>Lahat ng {photoLocation.photoCount} larawan ay may GPS, kaya ginamit namin ang gitnang punto nila.</p>
              </div>
            </div>
          ) : (
            <div className="rg-notice rg-warning" role="alert">
              <MapPin size={18} />
              <div>
                <strong>Kailangan ng pin</strong>
                <p>{photoLocation.requiresManualPin && photoLocation.gpsCount
                  ? "Higit 1 km ang layo ng mga larawan sa isa't isa. I-tap ang mapa kung nasaan ang bukid."
                  : `${photoLocation.photoCount - photoLocation.gpsCount} sa ${photoLocation.photoCount} larawan ang walang GPS. I-tap ang mapa kung nasaan ang bukid.`}</p>
              </div>
            </div>
          )}
          <FieldMap
            onPick={(lat, lng) => {
              setPin({ lat, lng });
              setPinSource("manual");
            }}
            points={pin ? [{ ...pin, id: "selection", name: place || "Bukid", severity: "unknown" }] : []}
          />
          <p className="rg-location">
            <MapPin size={16} />
            {pin ? (place || "Hinahanap ang barangay…") : "Wala pang pin"}
          </p>
          {pinSource === "manual" && autoLocation ? (
            <button type="button" className="rg-button rg-secondary" disabled={busy}
              onClick={() => { setPin(autoLocation); setPinSource("photo_average"); }}>
              Gamitin ulit ang GPS ng larawan
            </button>
          ) : null}
          {resumableSurvey ? <p role="status">Itutuloy ang dating survey gamit ang naunang lokasyon nito.</p> : null}
          <button
            className="rg-button rg-primary"
            disabled={busy || !files.length || (!resumableSurvey && !pin)}
            type="submit"
          >
            <UploadCloud size={18} />
            {demo ? "Create demo survey" : resumableSurvey ? "Ituloy ang upload" : "I-upload at suriin"}
          </button>
          <p className="rg-muted rg-upload-after">
            {busy
              ? "Huwag isara ang page habang nag-a-upload."
              : "Pagkatapos nito, awtomatiko na ang detection, severity, payo, pag-post sa bulletin at SMS sa mga magsasaka."}
          </p>
        </aside>
      </form>
    </>
  );
}
export function LegacyReviewWorkspace() {
  const { data, demo, review } = useOperations();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState(
    params.get("survey") || data.surveys[0]?.id || "",
  );
  const survey = data.surveys.find((s) => s.id === selected);
  const [zoom, setZoom] = useState(1);
  const [overlay, setOverlay] = useState(true);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const viewer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setPrediction(null);
    setApproved(false);
    setZoom(1);
  }, [selected]);
  const importResult = async (file?: File) => {
    if (!file) return;
    try {
      const result = validatePrediction(JSON.parse(await file.text()));
      setPrediction(result);
      toast.success(
        "Result contract validated. Coordinate alignment still needs visual review.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <>
      <div className="rg-page-heading">
        <div>
          <div className="rg-eyebrow">EVIDENCE BEFORE PUBLICATION</div>
          <h1>Detection review</h1>
          <p>
            Zoom into native image detail. Verify boundaries, labels, and
            location.
          </p>
        </div>
        <select
          aria-label="Selected survey"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {data.surveys.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="rg-review-workspace">
        <section className="rg-panel">
          <div className="rg-viewer-toolbar">
            <div className="rg-segment">
              <button
                className={!overlay ? "selected" : ""}
                disabled
                title="Paired original is not bound to this sample. Comparing unrelated images is disabled."
              >
                Original unavailable
              </button>
              <button
                className={overlay ? "selected" : ""}
                onClick={() => setOverlay(true)}
              >
                <Eye size={15} />
                Overlay sample
              </button>
            </div>
            <div>
              <button
                className="rg-icon-button"
                aria-label="Zoom out"
                onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
              >
                <ZoomOut size={18} />
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                className="rg-icon-button"
                aria-label="Zoom in"
                onClick={() => setZoom((z) => Math.min(4, z + 0.5))}
              >
                <ZoomIn size={18} />
              </button>
            </div>
          </div>
          <div className="rg-image-viewer" ref={viewer}>
            <img
              style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
              src={
                overlay
                  ? "/evidence/tiled-4k-smoke-preview.jpg"
                  : "/images/drone-shot.png"
              }
              alt={
                overlay
                  ? "Historical tiled prediction, not selected survey’s live result"
                  : "Reference drone photo, not a paired original for this overlay"
              }
            />
          </div>
          <div className="rg-notice">
            <CircleAlert size={17} />
            Archived reference images only. These are not paired
            original/overlay results for the selected survey. Live review
            remains blocked until aligned artifacts are available.
          </div>
        </section>
        <aside className="rg-panel rg-form">
          <h2>{survey?.name || "Select a survey"}</h2>
          <p>{survey?.location}</p>
          <div className="rg-review-measures">
            <span>
              Processing<strong>{survey?.status || "Unavailable"}</strong>
            </span>
            <span>
              Model confidence
              <strong>
                {prediction ? "Per lesion in result" : "Not available"}
              </strong>
            </span>
            <span>
              Image mask coverage<strong>Not measured here</strong>
            </span>
            <span>
              Agronomic severity
              <strong>
                {survey?.severity || "unknown"} · reviewer assigned
              </strong>
            </span>
          </div>
          {demo && (
            <label className="rg-button rg-secondary rg-file-button">
              Validate result JSON
              <input
                type="file"
                accept=".json"
                onChange={(e) => void importResult(e.target.files?.[0])}
              />
            </label>
          )}
          {prediction && (
            <div className="rg-notice">
              <CheckCircle2 size={18} />
              <span>
                {prediction.model_versions
                  ? `${prediction.model_versions.BLB} / ${prediction.model_versions["Brown Spot"]}`
                  : prediction.model_version} · {prediction.lesions.length}{" "}
                candidates · {prediction.width}×{prediction.height}. Imported
                result is not bound to this historical image.
              </span>
            </div>
          )}
          <label className="rg-check">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
              disabled={!demo || !survey || survey.status !== "Needs review"}
            />
            {demo
              ? "Mark this synthetic review as complete (demo only)."
              : "Live approval requires bound result and reviewed geometry."}
          </label>
          <button
            className="rg-button rg-primary"
            disabled={!demo || !approved || busy || !survey}
            onClick={async () => {
              if (!survey) return;
              setBusy(true);
              try {
                await review(survey.id);
                toast.success(
                  "Demo review completed. No real annotation or diagnosis changed.",
                );
                setApproved(false);
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <CheckCircle2 size={17} />
            Complete demo review
          </button>
          <small>
            Failed or incomplete processing must never be shown as “Healthy.”
          </small>
        </aside>
      </div>
    </>
  );
}

type ReviewAssetResult = {
  source_asset_id: string;
  kind: "image" | "video" | "telemetry_sidecar";
  width: number;
  height: number;
  classes?: Record<string, { predicted_pixels?: number; mask_fraction_of_image?: number }>;
  diseases?: { disease: "BLB" | "Brown Spot"; status: "detected" | "not_detected"; predicted_pixels: number }[];
  ambiguous_overlap_pixels?: number;
};
type FindingDecision = "accepted" | "rejected" | "uncertain";

export function ReviewWorkspace() {
  const { data, refresh, operation } = useOperations();
  const [params, setParams] = useSearchParams();
  const surveyChoice = params.get("survey") || data.surveys[0]?.id || "";
  const selectedSurvey = data.surveys.some(item => item.id === surveyChoice) ? surveyChoice : "";
  const survey = data.surveys.find((item) => item.id === selectedSurvey);
  const requestedAdvisory = params.get("advisory");
  const bulletin = requestedAdvisory ? data.bulletins.find(item => item.id === requestedAdvisory && item.survey_id === survey?.id && (item.status === "published" || item.result_revision === survey?.active_result_revision))
    : survey ? currentSeverityBulletin(survey, data.bulletins) : undefined;
  const latestJob = data.jobs.find((item) => item.survey_id === selectedSurvey);
  const job = data.jobs.find((item) => item.survey_id === selectedSurvey && item.result_manifest);
  const v2Result = ["aws", "kaggle_yolo26"].includes(job?.provider || "") &&
    job?.result_manifest?.schema_version === "riceguard.result.v2";
  // Snapshot refreshes produce new object references; only changed evidence
  // should reset a staff member's checkbox, layer selection, or decisions.
  const assetsJson = JSON.stringify(job?.result_manifest?.assets || []);
  const resultAssets = useMemo(
    () => (JSON.parse(assetsJson) as ReviewAssetResult[]).filter((item) => item.kind !== "telemetry_sidecar"),
    [assetsJson],
  );
  const savedDecisionsJson = JSON.stringify(job?.finding_reviews || []);
  const [assetId, setAssetId] = useState("");
  const [variant, setVariant] = useState<"original" | "BLB" | "Brown Spot" | "combined" | "video">("combined");
  const [zoom, setZoom] = useState(1);
  const [geometryChecked, setGeometryChecked] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, FindingDecision>>({});
  const [mediaApproved, setMediaApproved] = useState(false);
  const [imageDirty, setImageDirty] = useState(false);
  const [locationApproved, setLocationApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [videoStarted, setVideoStarted] = useState(false);
  const mediaPointerStart = useRef<number | null>(null);
  const reviewVideo = useRef<HTMLVideoElement>(null);
  const asset = resultAssets.find((item) => item.source_asset_id === assetId) || resultAssets[0];
  const urls = asset ? job?.review_urls?.[asset.source_asset_id] || {} : {};
  const shownVariant = asset?.kind === "video" ? "video" : variant;
  const url = urls[shownVariant];
  const findingKey = (assetId: string, disease: string) => `${assetId}:${disease}`;
  const assetIndex = Math.max(0, resultAssets.findIndex((item) => item.source_asset_id === asset?.source_asset_id));
  const selectAsset = (index: number) => {
    if (!resultAssets.length) return;
    const next = resultAssets[(index + resultAssets.length) % resultAssets.length];
    setAssetId(next.source_asset_id);
    setVariant(next.kind === "video" ? "video" : "combined");
    setZoom(1);
    setVideoStarted(false);
  };
  const predictedPixels = (disease: "BLB" | "Brown Spot") =>
    asset?.diseases?.find((finding) => finding.disease === disease)?.predicted_pixels ??
    asset?.classes?.[disease]?.predicted_pixels;
  const approvalBlockedReason = !survey
    ? "Select a survey first."
    : survey.status === "Reviewed"
      ? "Image review saved. Continue to severity for this same survey."
      : survey.status !== "Needs review"
        ? `Approval is available only at “Needs review”; this survey is currently “${survey.status}”.`
        : !job || !url
          ? "Validated review media is still unavailable."
          : !v2Result && !geometryChecked
            ? "Check the displayed alignment and geometry first."
            : !mediaApproved
              ? "Check the complete-survey approval box first."
              : null;

  useEffect(() => {
    setAssetId(resultAssets[0]?.source_asset_id || "");
    setVariant(resultAssets[0]?.kind === "video" ? "video" : "combined");
    setGeometryChecked(false);
    const saved = JSON.parse(savedDecisionsJson) as { source_asset_id: string; disease: string; decision: FindingDecision }[];
    setDecisions(Object.fromEntries(resultAssets.flatMap((item) => (item.diseases || []).map((finding) => [
      findingKey(item.source_asset_id, finding.disease),
      saved.find(row => row.source_asset_id === item.source_asset_id && row.disease === finding.disease)?.decision || "accepted" as FindingDecision,
    ]))));
    setMediaApproved(false);
    setLocationApproved(false);
    setImageDirty(false);
  }, [selectedSurvey, job?.id, resultAssets, savedDecisionsJson, survey?.lat, survey?.lng, survey?.location_status]);

  const approve = async () => {
    if (!survey?.active_result_revision) return;
    setBusy(true);
    try {
      await operation("review-survey", {
        id: survey.id,
        result_revision: survey.active_result_revision,
        location_approved: locationApproved,
        media_approved: mediaApproved,
        ...(v2Result ? { reviews: resultAssets.flatMap((item) => (item.diseases || []).map((finding) => ({
          source_asset_id: item.source_asset_id,
          disease: finding.disease,
          decision: decisions[findingKey(item.source_asset_id, finding.disease)],
        }))) } : {}),
      });
      setImageDirty(false);
      await refresh();
      toast.success("Image review saved. Continue to severity, location and publication. No advisory generation or publication was started.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="rg-journey-survey-picker"><label>Select survey
        <select aria-label="Selected survey" value={selectedSurvey} onChange={event => setParams({ survey:event.target.value, step:"images" })}>
          {!selectedSurvey ? <option value="">Requested survey not found</option> : null}
          {data.surveys.map(item => <option key={item.id} value={item.id}>{item.name} · {new Date(item.captured_at).toLocaleDateString("en-PH")} · {item.id.slice(0,8)}</option>)}
        </select></label></div>
      {!selectedSurvey && params.get("survey") ? <p role="alert">The requested survey is unavailable. Another survey has not been substituted.</p> : null}
      {requestedAdvisory && !bulletin ? <p role="alert">This advisory does not belong to the selected current result. Select the intended survey again.</p> : null}
      <ReviewJourney survey={survey} bulletin={bulletin} imageDirty={imageDirty} onDiscardImages={()=>setImageDirty(false)}>
      <div className="rg-review-workspace rg-review-live">
        <section className="rg-panel">
          <div className="rg-viewer-toolbar">
            <div className="rg-segment" role="group" aria-label="Result layer">
              {(asset?.kind === "video" ? ["video"] : ["original", "BLB", "Brown Spot", "combined"]).map((name) => (
                <button key={name} className={shownVariant === name ? "selected" : ""} onClick={() => setVariant(name as typeof variant)} disabled={!urls[name]}>
                  {name === "combined" ? "Both diseases" : name}
                </button>
              ))}
            </div>
            {asset?.kind !== "video" ? (
              <div>
                <button className="rg-icon-button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(1, value - 0.5))}><ZoomOut size={18} /></button>
                <span>{Math.round(zoom * 100)}%</span>
                <button className="rg-icon-button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(5, value + 0.5))}><ZoomIn size={18} /></button>
              </div>
            ) : null}
          </div>
          <div className={`rg-image-viewer rg-live-viewer ${zoom === 1 ? "is-fit" : "is-zoomed"}`}
            onPointerDown={(event) => { mediaPointerStart.current = event.clientX; }}
            onPointerUp={(event) => {
              if (mediaPointerStart.current == null || resultAssets.length < 2 || zoom > 1 || (event.target as HTMLElement).closest("button,video")) return;
              const distance = event.clientX - mediaPointerStart.current;
              mediaPointerStart.current = null;
              if (Math.abs(distance) > 45) selectAsset(assetIndex + (distance < 0 ? 1 : -1));
            }}>
            {resultAssets.length > 1 ? <button type="button" className="rg-gallery-arrow previous" aria-label="Previous uploaded media" onClick={() => selectAsset(assetIndex - 1)}><ChevronLeft /></button> : null}
            {!url ? (
              <div className="rg-empty">
                <CircleAlert size={30} />
                <h3>Aligned review media is unavailable</h3>
                <p>The survey cannot be approved until validated artifacts are returned.</p>
                <Link className="rg-button rg-secondary" to="../surveys">Open survey queue</Link>
              </div>
            ) : asset?.kind === "video" ? (
              <div className="rg-video-playback"><video ref={reviewVideo} src={url} controls={videoStarted} playsInline preload="metadata" aria-label="Frame-aligned annotated review video" />
                {!videoStarted ? <button type="button" className="rg-tap-to-play" onClick={() => { setVideoStarted(true); void reviewVideo.current?.play(); }}><Play size={26} fill="currentColor" /> Tap to play video</button> : null}
              </div>
            ) : (
              <img
                src={url}
                style={zoom > 1 ? { width: `${zoom * 100}%`, maxWidth: "none", maxHeight: "none" } : undefined}
                alt={`${shownVariant} review layer for the selected uploaded image`}
              />
            )}
            {resultAssets.length > 1 ? <button type="button" className="rg-gallery-arrow next" aria-label="Next uploaded media" onClick={() => selectAsset(assetIndex + 1)}><ChevronRight /></button> : null}
          </div>
          <div className="rg-review-pagination">
            <span>{resultAssets.length ? `${assetIndex + 1} / ${resultAssets.length}` : "No aligned review media yet"}</span>
            {resultAssets.length > 1 ? <small>Swipe on mobile or use the arrows on desktop.</small> : null}
          </div>
        </section>
        <aside className="rg-panel rg-form">
          <h2>{survey?.name || "Select a survey"}</h2>
          <p>{survey?.location || "Location pending review"}</p>
          <div className="rg-review-measures">
            <span>Processing<strong>{survey?.status || "Unavailable"}</strong></span>
            <span>Result revision<strong>{survey?.active_result_revision || "Not available"}</strong></span>
            <span>{asset?.kind === "video" ? "BLB frame-pixel sum" : "BLB predicted pixels"}<strong>{predictedPixels("BLB")?.toLocaleString() ?? "Unavailable"}</strong></span>
            <span>{asset?.kind === "video" ? "Brown Spot frame-pixel sum" : "Brown Spot predicted pixels"}<strong>{predictedPixels("Brown Spot")?.toLocaleString() ?? "Unavailable"}</strong></span>
            <span>Ambiguous overlap<strong>{asset?.ambiguous_overlap_pixels?.toLocaleString() ?? "Not applicable"}</strong></span>
            <span>Reviewed damage grade<strong>{survey ? fieldSeverityLabel(fieldSeverityForSurvey(survey, data.bulletins)) : "Not assessed"}</strong></span>
            <span>AI severity calibration<strong>Not validated</strong></span>
          </div>
          {survey?.status === "Failed" ? (
            <>
              <div className="rg-notice rg-notice-error">
                <CircleAlert size={18} />
                <span>{latestJob?.error || "Private processing stopped before a review result was created."}</span>
              </div>
              <button className="rg-button rg-secondary" disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                  await operation("retry-processing", { id: survey.id });
                  await refresh();
                  toast.success("Private processing was safely re-queued from the verified originals.");
                } catch (error) {
                  toast.error((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}>
                Retry private processing
              </button>
            </>
          ) : null}
          {v2Result && asset?.diseases ? (
            <details className="rg-ai-decision-editor">
              <summary>{survey?.status === "Reviewed" ? "Approved decisions" : "Edit AI decisions"} for this {asset.kind === "video" ? "clip" : "photo"}</summary>
              <div className="rg-finding-decisions">
              {asset.diseases.map((finding) => (
                <label key={finding.disease}>
                  {finding.disease} · {finding.status === "detected" ? "candidate detected" : "no target detected"}
                  <select disabled={survey?.status === "Reviewed"} value={decisions[findingKey(asset.source_asset_id, finding.disease)] || ""}
                    onChange={(event) => { setImageDirty(true); setDecisions((current) => ({ ...current,
                      [findingKey(asset.source_asset_id, finding.disease)]: event.target.value as FindingDecision })); }}>
                    <option value="accepted">{finding.status === "detected" ? "Accept finding" : "Confirm no target detected"}</option>
                    <option value="rejected">Reject finding</option>
                    <option value="uncertain">Uncertain · do not publish this finding</option>
                  </select>
                </label>
              ))}
              </div>
            </details>
          ) : null}
          {!v2Result ? (
            <label className="rg-check"><input type="checkbox" checked={geometryChecked} onChange={(event) => {setGeometryChecked(event.target.checked);setImageDirty(true);}} disabled={!url} /> I checked alignment, tile seams, class mapping and conflicts on the displayed revision.</label>
          ) : null}
          <label className="rg-check rg-whole-approval"><input type="checkbox" checked={survey?.status === "Reviewed" || mediaApproved} onChange={(event) => {setMediaApproved(event.target.checked);setImageDirty(true);}} disabled={survey?.status === "Reviewed" || !url || (!v2Result && !geometryChecked)} />
            {survey?.status === "Reviewed" ? "This survey result and its review media are already approved." : "Approve this complete survey result, its sanitized review media, and the proposed advisory input."}</label>
          {survey?.lat != null && survey?.lng != null ? <p className="rg-auto-location"><MapPin size={16} /> Survey coordinates are attached automatically. You can still correct the pin before publication.</p> : null}
          <button className="rg-button rg-primary" disabled={busy || survey?.status !== "Needs review" ||
            (!v2Result && !geometryChecked) || !mediaApproved || !job}
            title={approvalBlockedReason || undefined}
            onClick={() => void approve()}>
            <CheckCircle2 size={17} /> {survey?.status === "Reviewed" ? "Image review saved" : busy ? "Approving…" : "Approve complete survey images"}
          </button>
          {approvalBlockedReason ? <small className="rg-disabled-reason" role="status">{approvalBlockedReason}</small> : null}
          <small>AI decisions are prefilled from the pinned model result. Use “Edit AI decisions” only when you need to correct a finding before approval.</small>
          <details className="rg-ai-decision-editor"><summary>How is severity measured?</summary><p>Severity means the proportion of rice leaf tissue damaged by a disease—not predicted pixels divided by the whole photo. Water, soil, and background must not be included.</p><p>BLB masks mark proposed disease regions; Brown Spot masks mark entire affected leaves, not individual lesions. Neither is a validated field-wide severity score. AI calibration requires independent specialist-scored leaves and a reviewed leaf-area denominator. Approval alone does not assign Low, Moderate, or Severe.</p></details>
        </aside>
      </div>
      </ReviewJourney>
    </>
  );
}
