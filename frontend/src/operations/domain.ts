export type Disease = "BLB" | "Brown Spot";
export type Severity =
  | "low"
  | "moderate"
  | "high"
  | "not_calibrated"
  | "unknown";
export type JobState =
  | "Awaiting upload"
  | "Validating"
  | "Queued"
  | "Submitting"
  | "Waiting for GPU"
  | "Running"
  | "Validating results"
  | "Needs review"
  | "Reviewed"
  | "Failed"
  | "Cancelled";
export type Point = [number, number];
export interface Lesion {
  class: Disease;
  confidence: number;
  polygon_native_px: Point[];
  area_px: number;
}
export interface Prediction {
  manifest_version?: string;
  model_versions?: { BLB: string; "Brown Spot": string };
  /** Legacy read-only artifact compatibility. New workers emit model_versions. */
  model_version?: string;
  width: number;
  height: number;
  lesions: Lesion[];
  measurements?: {
    blb_disease_region_coverage: number | null;
    brown_spot_affected_leaf_coverage: number | null;
    visible_rice_leaf_denominator_reviewed: boolean;
  };
  assessment?: {
    status: "not_calibrated" | "calibrated";
    label: Severity;
    calibration_version: string | null;
  };
  warnings?: string[];
  latency_ms: number;
  tile_count: number;
  profile: string;
}
export interface Survey {
  id: string;
  name: string;
  location: string;
  captured_at: string;
  camera: string;
  status: JobState;
  photos: number;
  severity: Severity;
  lat: number | null;
  lng: number | null;
  location_status?: "verified" | "extracted" | "needs_review" | "missing";
  progress?: number;
  stage_updated_at?: string;
  active_result_revision?: number | null;
  approved_result_revision?: number | null;
  note?: string;
}
export interface Bulletin {
  id: string;
  slug: string;
  title: string;
  location: string;
  disease: Disease;
  severity: Severity;
  body: string;
  action: string;
  date: string;
  status: "draft" | "published";
  image: string;
  reviewer: string | null;
  sample?: boolean;
  lat: number | null;
  lng: number | null;
  published_at?: string;
  updated_at?: string;
  approximate_location?: boolean;
  media?: { url: string; alt: string; type: "image" | "video" }[];
  revision?: number;
  advisory_revision?: number;
  result_revision?: number | null;
}
export interface Contact {
  id: string;
  name: string;
  phone: string;
  location: string;
  consent: boolean;
  verified: boolean;
  farms: { lat: number; lng: number }[];
}
export interface Campaign {
  id: string;
  bulletin_id: string;
  created_at: string;
  recipients: number;
  status:
    | "queued"
    | "accepted"
    | "sent"
    | "delivered"
    | "failed"
    | "unknown"
    | "suppressed";
  sample: boolean;
}
export interface Asset {
  id: string;
  survey_id: string;
  name: string;
  mime: string;
  bytes: number;
  status: string;
  preview_url: string | null;
  drive_file_id: string | null;
  checksum: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
}
export interface ProcessingJob {
  id: string;
  survey_id: string;
  status: JobState;
  progress: number;
  kaggle_kernel_ref: string | null;
  run_id: string;
  error: string | null;
  result_manifest?: Record<string, unknown> | null;
  review_urls?: Record<string, Record<string, string>>;
  created_at: string;
  updated_at: string;
}
export interface ProviderStatus {
  drive: "connected" | "configuration_required" | "error";
  kaggle: "connected" | "configuration_required" | "waiting_for_quota" | "error";
  sms: "connected" | "offline" | "credentials_present" | "configuration_required" | "error";
  advisory: "connected" | "configuration_required" | "error";
}
export interface ModelRegistryItem {
  id: string;
  disease: Disease;
  version: string;
  architecture: string;
  encoder: string;
  input_size: number;
  overlap: number;
  threshold: number;
  minimum_component_pixels: number;
  active: boolean;
  validation_summary: Record<string, unknown>;
}
export interface OperationsData {
  surveys: Survey[];
  bulletins: Bulletin[];
  contacts: Contact[];
  campaigns: Campaign[];
  assets: Asset[];
  jobs: ProcessingJob[];
  providers: ProviderStatus;
  models: ModelRegistryItem[];
}

export function normalizePhone(value: string): string {
  const compact = value.replace(/[\s()-]/g, "");
  const phone = compact.startsWith("09")
    ? "+63" + compact.slice(1)
    : compact.startsWith("639")
      ? "+" + compact
      : compact;
  if (!/^\+639\d{9}$/.test(phone))
    throw new Error("Gumamit ng Philippine mobile number: 09XXXXXXXXX.");
  return phone;
}
const gsm =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const extended = "^{}\\[~]|€";
export function smsSegments(text: string) {
  const unicode = [...text].some(
    (c) => !gsm.includes(c) && !extended.includes(c),
  );
  const units = unicode
    ? text.length
    : [...text].reduce((n, c) => n + (extended.includes(c) ? 2 : 1), 0);
  const single = unicode ? 70 : 160;
  const multipart = unicode ? 67 : 153;
  return {
    encoding: unicode ? "Unicode" : "GSM-7",
    units,
    segments:
      units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multipart),
  };
}
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const r = Math.PI / 180;
  const dlat = (b.lat - a.lat) * r;
  const dlng = (b.lng - a.lng) * r;
  return (
    6371008.8 *
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin(dlat / 2) ** 2 +
          Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlng / 2) ** 2,
      ),
    )
  );
}
// Demo point matching only. Live matching uses PostGIS farm geometry, not residence.
export function eligibleContacts(
  contacts: Contact[],
  point: { lat: number; lng: number },
) {
  return [
    ...new Map(
      contacts
        .filter(
          (c) =>
            c.consent &&
            c.verified &&
            c.farms.some((f) => distanceMeters(f, point) <= 3000),
        )
        .map((c) => [normalizePhone(c.phone), c]),
    ).values(),
  ];
}
export function validatePrediction(value: unknown): Prediction {
  const v = value as Prediction;
  if (
    !v ||
    !(v.model_versions?.BLB || v.model_versions?.["Brown Spot"] || v.model_version) ||
    ![v.width, v.height].every((n) => Number.isInteger(n) && n > 0) ||
    !Array.isArray(v.lesions)
  )
    throw new Error("Invalid inference result or missing native dimensions.");
  if (![v.latency_ms, v.tile_count].every((n) => Number.isFinite(n) && n >= 0))
    throw new Error("Missing runtime report.");
  for (const l of v.lesions) {
    if (
      !["BLB", "Brown Spot"].includes(l.class) ||
      !Number.isFinite(l.confidence) ||
      l.confidence < 0 ||
      l.confidence > 1 ||
      !Number.isFinite(l.area_px) ||
      l.area_px <= 0
    )
      throw new Error("Invalid disease mapping, confidence or area.");
    if (
      !Array.isArray(l.polygon_native_px) ||
      l.polygon_native_px.length < 3 ||
      l.polygon_native_px.some(
        (p) =>
          p.length !== 2 ||
          !p.every(Number.isFinite) ||
          p[0] < 0 ||
          p[1] < 0 ||
          p[0] > v.width ||
          p[1] > v.height,
      )
    )
      throw new Error("Polygon is outside native image coordinates.");
  }
  return v;
}
export function resultDescription(state: JobState, prediction?: Prediction) {
  if (state !== "Needs review" && state !== "Reviewed") return state;
  if (!prediction) return "Result unavailable — review blocked";
  return prediction.lesions.length
    ? "Target disease candidates — operator review required"
    : "No target disease detected";
}
export function isQuietHour(date: Date) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Manila",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date),
  );
  return hour >= 20 || hour < 6;
}
