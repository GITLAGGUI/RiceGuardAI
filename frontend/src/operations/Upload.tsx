import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  UploadCloud,
  CheckCircle2,
  CircleAlert,
  MapPin,
  ZoomIn,
  ZoomOut,
  Eye,
  FileImage,
  Info,
} from "lucide-react";
import * as exifr from "exifr";
import { createMD5, createSHA256 } from "hash-wasm";
import { toast } from "sonner";
import { FieldMap } from "./Map";
import { useOperations, operation } from "./store";
import { validatePrediction, type Prediction } from "./domain";
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
  let meta: Record<string, number> | null = null;
  if (kind === "image") {
    const bitmap = await createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
    if (width < 512 || height < 512 || width > 30000 || height > 30000)
      throw new Error(`${file.name}: unsupported image dimensions.`);
    meta = await exifr.parse(file, ["Orientation", "latitude", "longitude", "DateTimeOriginal"]).catch(() => null);
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
    orientation: meta?.Orientation || 1,
    mime,
    kind,
    gps:
      Number.isFinite(meta?.latitude) && Number.isFinite(meta?.longitude)
        ? { latitude: meta!.latitude, longitude: meta!.longitude }
        : undefined,
    status: "Validated locally",
    progress: 0,
  };
}
export function UploadWorkspace() {
  const { demo, addSurvey } = useOperations();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const base = demo ? "/demo" : "/admin";
  const choose = async (selected: FileList | File[]) => {
    if (busy) return;
    if (files.length + selected.length > 250) {
      toast.error("Maximum 250 files per batch.");
      return;
    }
    setBusy(true);
    const next = [...files];
    const failures: string[] = [];
    try {
      for (const f of Array.from(selected)) {
        try {
          const record = await inspect(f);
          if (next.some((x) => x.hash === record.hash)) {
            failures.push(`${f.name}: exact duplicate skipped.`);
            continue;
          }
          next.push(record);
          if (!pin && record.gps) {
            setPin({ lat: record.gps.latitude, lng: record.gps.longitude });
            setConfirmed(false);
          }
        } catch (e) {
          failures.push((e as Error).message);
        }
      }
      setFiles(next);
      setErrors(failures);
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!files.length || (pin && !confirmed)) return;
    const form = new FormData(e.currentTarget);
    const id = crypto.randomUUID();
    setBusy(true);
    try {
      await addSurvey({
        id,
        name: String(form.get("name")),
        location: String(form.get("location")),
        captured_at: new Date(String(form.get("captured_at"))).toISOString(),
        camera: String(form.get("camera")),
        status: "Awaiting upload",
        photos: files.length,
        severity: "not_calibrated",
        lat: pin?.lat ?? null,
        lng: pin?.lng ?? null,
        location_status: pin ? "needs_review" : "missing",
      });
      if (demo) {
        toast.success(
          "Demo survey created. Original files stayed on this device; no inference ran.",
        );
        return;
      }
      for (const f of files) {
        try {
          const intent = await operation("upload-intent", {
            flight_id: id,
            captured_at: new Date(
              String(form.get("captured_at")),
            ).toISOString(),
            camera_id: String(form.get("camera")),
            width: f.width,
            height: f.height,
            checksum: f.hash,
            md5_checksum: f.md5,
            bytes: f.file.size,
            content_type: f.mime,
            orientation: f.orientation,
            filename: f.file.name,
            duration_seconds: f.duration,
            exif_lat: f.gps?.latitude,
            exif_lng: f.gps?.longitude,
          });
          const driveFileId = await new Promise<string>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", intent.upload_url);
            Object.entries(intent.required_headers || {}).forEach(([k, v]) =>
              xhr.setRequestHeader(k, String(v)),
            );
            xhr.upload.onprogress = (p) => {
              if (p.lengthComputable)
                setFiles((fs) =>
                  fs.map((x) =>
                    x.id === f.id
                      ? {
                          ...x,
                          progress: Math.round((p.loaded / p.total) * 100),
                          status: "Uploading",
                        }
                      : x,
                  ),
                );
            };
            xhr.onload = () => {
              if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(`Upload failed: ${xhr.status}`));
              try {
                const result = JSON.parse(xhr.responseText);
                if (!result.id) throw new Error("Drive did not return a file identifier");
                resolve(result.id);
              } catch (error) { reject(error); }
            };
            xhr.onerror = () =>
              reject(new Error("Upload interrupted; retry this photo."));
            xhr.send(f.file);
          });
          await operation("upload-complete", { asset_id: intent.asset_id, drive_file_id: driveFileId });
          setFiles((fs) =>
            fs.map((x) =>
              x.id === f.id
                ? { ...x, progress: 100, status: "Verified and queued when batch is complete" }
                : x,
            ),
          );
        } catch (e) {
          setFiles((fs) =>
            fs.map((x) =>
              x.id === f.id ? { ...x, status: (e as Error).message } : x,
            ),
          );
        }
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
          <div className="rg-eyebrow">CAPTURE → UPLOAD → REVIEW</div>
          <h1>Create a drone survey</h1>
          <p>
            Upload original photos, MP4 videos and optional DJI telemetry. Missing GPS does not block image analysis.
          </p>
        </div>
        <Link to={`${base}/surveys`} className="rg-button rg-secondary">
          All surveys
        </Link>
      </div>
      <form className="rg-upload-grid" onSubmit={submit}>
        <section className="rg-panel rg-form">
          <h2>01 · Flight details</h2>
          <div className="rg-form-grid">
            <label>
              Survey name
              <input
                required
                name="name"
                placeholder="Santa Maria · Morning flight"
                maxLength={160}
              />
            </label>
            <label>
              Camera / aircraft ID
              <input
                required
                name="camera"
                placeholder="DJI-LITO-X1-01"
                maxLength={120}
              />
            </label>
            <label>
              Capture date & time
              <input required type="datetime-local" name="captured_at" />
            </label>
            <label>
              Location note
              <input
                name="location"
                placeholder="Barangay, municipality, province (optional until review)"
                maxLength={240}
              />
            </label>
          </div>
          <h2>02 · Original media</h2>
          <label
            className="rg-dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void choose(e.dataTransfer.files);
            }}
          >
            <UploadCloud size={36} />
            <strong>
              {busy ? "Working on the batch…" : "Drop drone photos, videos or telemetry here"}
            </strong>
            <span>or tap to browse · JPEG / PNG / MP4 / SRT / CSV / JSON · up to 250 files</span>
            <input
              type="file"
              accept="image/jpeg,image/png,video/mp4,.srt,.csv,.json"
              multiple
              disabled={busy}
              onChange={(e) => {
                if (e.target.files) void choose(e.target.files);
                e.target.value = "";
              }}
            />
            <small>
              Native dimensions preserved. SHA-256 exact-duplicate checking.
            </small>
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
                    {(f.file.size / 1048576).toFixed(1)} MB ·{" "}
                    {f.gps
                      ? "EXIF GPS extracted; confirm below"
                      : "No embedded GPS; location can be resolved during review"}
                  </small>
                  <small>{f.status}</small>
                  <progress
                    aria-label={`Upload progress for ${f.file.name}`}
                    value={f.progress}
                    max={100}
                  />
                </span>
                <button
                  type="button"
                  className="rg-icon-button"
                  aria-label={`Remove ${f.file.name}`}
                  disabled={busy}
                  onClick={() =>
                    setFiles((fs) => fs.filter((x) => x.id !== f.id))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
        <aside className="rg-panel rg-form">
          <h2>03 · Confirm the field</h2>
          <p className="rg-muted">
            Confirm extracted GPS when available. A photo’s GPS is a camera location, not a georeferenced lesion. Analysis may continue without a location, but 3 km SMS targeting cannot.
          </p>
          <FieldMap
            onPick={(lat, lng) => {
              setPin({ lat, lng });
              setConfirmed(false);
            }}
            points={
              pin
                ? [
                    {
                      ...pin,
                      id: "selection",
                      name: "Proposed survey location",
                      severity: "unknown",
                    },
                  ]
                : []
            }
          />
          <p className="rg-location">
            <MapPin size={16} />
            {pin
              ? `${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}`
              : "No location yet — analysis is still allowed"}
          </p>
          <label className="rg-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!pin}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I verified the surveyed field in Region II. Server coverage
            validation is required before live processing.
          </label>
          <button
            className="rg-button rg-primary"
            disabled={busy || !files.length || Boolean(pin && !confirmed)}
            type="submit"
          >
            <UploadCloud size={18} />
            {demo ? "Create demo survey" : "Create survey & upload"}
          </button>
          <div className="rg-notice">
            <CircleAlert size={18} />
            {demo
              ? "Preview mode does not upload files or generate synthetic predictions for your photos."
              : "If the GPU is offline, valid jobs remain queued. Upload completion does not mean analysis is complete."}
          </div>
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
  classes: Record<string, { predicted_pixels?: number; mask_fraction_of_image?: number }>;
  ambiguous_overlap_pixels?: number;
};

export function ReviewWorkspace() {
  const { data, refresh } = useOperations();
  const [params] = useSearchParams();
  const [selectedSurvey, setSelectedSurvey] = useState(params.get("survey") || data.surveys[0]?.id || "");
  const survey = data.surveys.find((item) => item.id === selectedSurvey);
  const job = data.jobs.find((item) => item.survey_id === selectedSurvey && item.result_manifest);
  const resultAssets = useMemo(
    () => ((job?.result_manifest?.assets || []) as ReviewAssetResult[]).filter((item) => item.kind !== "telemetry_sidecar"),
    [job?.result_manifest?.assets],
  );
  const [assetId, setAssetId] = useState("");
  const [variant, setVariant] = useState<"original" | "BLB" | "Brown Spot" | "combined" | "video">("combined");
  const [zoom, setZoom] = useState(1);
  const [geometryChecked, setGeometryChecked] = useState(false);
  const [mediaApproved, setMediaApproved] = useState(false);
  const [locationApproved, setLocationApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const asset = resultAssets.find((item) => item.source_asset_id === assetId) || resultAssets[0];
  const urls = asset ? job?.review_urls?.[asset.source_asset_id] || {} : {};
  const shownVariant = asset?.kind === "video" ? "video" : variant;
  const url = urls[shownVariant];

  useEffect(() => {
    setAssetId(resultAssets[0]?.source_asset_id || "");
    setVariant(resultAssets[0]?.kind === "video" ? "video" : "combined");
    setGeometryChecked(false);
    setMediaApproved(false);
    setLocationApproved(survey?.location_status === "verified");
  }, [selectedSurvey, job?.id, resultAssets, survey?.location_status]);

  const approve = async () => {
    if (!survey?.active_result_revision) return;
    setBusy(true);
    try {
      await operation("review-survey", {
        id: survey.id,
        result_revision: survey.active_result_revision,
        location_approved: locationApproved,
        media_approved: mediaApproved,
      });
      await refresh();
      toast.success("Exact result revision reviewed. Advisory approval remains separate.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="rg-page-heading">
        <div>
          <div className="rg-eyebrow">ORIGINAL → MASKS → ADVISORY DRAFT</div>
          <h1>Detection review</h1>
          <p>Review the uploaded media and exact result revision. BLB and Brown Spot remain separate overlays.</p>
        </div>
        <select aria-label="Selected survey" value={selectedSurvey} onChange={(event) => setSelectedSurvey(event.target.value)}>
          {data.surveys.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </div>
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
          <div className="rg-image-viewer rg-live-viewer">
            {!url ? (
              <div className="rg-empty"><CircleAlert size={30} /><h3>Aligned review media is unavailable</h3><p>The survey cannot be approved until validated artifacts are returned.</p></div>
            ) : asset?.kind === "video" ? (
              <video src={url} controls preload="metadata" aria-label="Frame-aligned annotated review video" />
            ) : (
              <img src={url} style={{ width: `${zoom * 100}%`, maxWidth: "none" }} alt={`${shownVariant} review layer for the selected uploaded image`} />
            )}
          </div>
          <div className="rg-review-thumbnails">
            {resultAssets.map((item, index) => (
              <button key={item.source_asset_id} className={asset?.source_asset_id === item.source_asset_id ? "selected" : ""} onClick={() => { setAssetId(item.source_asset_id); setVariant(item.kind === "video" ? "video" : "combined"); setZoom(1); }}>
                {item.kind === "video" ? "Video" : "Image"} {index + 1}
              </button>
            ))}
          </div>
        </section>
        <aside className="rg-panel rg-form">
          <h2>{survey?.name || "Select a survey"}</h2>
          <p>{survey?.location || "Location pending review"}</p>
          <div className="rg-review-measures">
            <span>Processing<strong>{survey?.status || "Unavailable"}</strong></span>
            <span>Result revision<strong>{survey?.active_result_revision || "Not available"}</strong></span>
            <span>BLB predicted pixels<strong>{asset?.classes?.BLB?.predicted_pixels?.toLocaleString() ?? "Video frame series"}</strong></span>
            <span>Brown Spot predicted pixels<strong>{asset?.classes?.["Brown Spot"]?.predicted_pixels?.toLocaleString() ?? "Video frame series"}</strong></span>
            <span>Ambiguous overlap<strong>{asset?.ambiguous_overlap_pixels?.toLocaleString() ?? "Not applicable"}</strong></span>
            <span>Agronomic severity<strong>Not yet calibrated</strong></span>
          </div>
          <div className="rg-notice"><Info size={17} /> Pixel counts are diagnostics. Coverage needs a reviewed visible-rice-leaf denominator, and Brown Spot whole-leaf coverage is not lesion severity.</div>
          <label className="rg-check"><input type="checkbox" checked={geometryChecked} onChange={(event) => setGeometryChecked(event.target.checked)} disabled={!url} /> I checked alignment, tile seams, class mapping and conflicts on the displayed revision.</label>
          <label className="rg-check"><input type="checkbox" checked={mediaApproved} onChange={(event) => setMediaApproved(event.target.checked)} disabled={!geometryChecked} /> The selected public preview removes precise GPS metadata and is suitable for publication.</label>
          <label className="rg-check"><input type="checkbox" checked={locationApproved} onChange={(event) => setLocationApproved(event.target.checked)} disabled={survey?.lat == null || survey?.lng == null} /> The approximate public location is verified. Leave unchecked when location is missing; analysis may still be approved without geographic SMS.</label>
          <button className="rg-button rg-primary" disabled={busy || survey?.status !== "Needs review" || !geometryChecked || !mediaApproved || !job} onClick={() => void approve()}>
            <CheckCircle2 size={17} /> Approve result revision
          </button>
          <small>Failed or incomplete processing can never become “Healthy.” A successful empty mask is “No target disease detected.”</small>
        </aside>
      </div>
    </>
  );
}
