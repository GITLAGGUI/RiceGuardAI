// GABAY: Mga TypeScript type ng data (Survey, Asset, Bulletin, Contact...). Kapag nagdagdag ka ng column sa database,
// idagdag din dito ang field para makita ito ng frontend.
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
  | "Waiting for allowance"
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
/** Automated severity: the most affected photo per disease, graded on the IRRI SES scale. */
export interface SeverityDetail {
  method: "representative_photo_ses_v1";
  formula: string;
  overall: "low" | "moderate" | "high";
  photos: number;
  usable_photos: number;
  diseases: Partial<Record<Disease, {
    percent: number; ses_score: number; category: "low" | "moderate" | "high";
    representative_asset_id: string; photo_number: number; lesion_pixels: number; plant_pixels: number;
    affected_photos: number; usable_photos: number;
  }>>;
}
export interface Place {
  method: "inside" | "nearest" | "region_only" | "outside_region" | "none";
  label?: string; barangay?: string; municipality?: string; province?: string; barangay_code?: string;
}
/** A published photo: base image plus one transparent layer per disease for the viewer. */
export interface PublicPhoto {
  url: string; alt: string; type: "image" | "video"; width?: number; height?: number; source_asset_id?: string;
  original_url?: string; layers?: Partial<Record<Disease, string>>; diseases?: Disease[]; photo_number?: number;
}
export interface WebSource { n: number; title: string; url: string; publisher: string; approved?: boolean }
export type AutoStatus = "pending" | "running" | "retry" | "done" | "failed";
export interface PipelineStep {
  id: number; survey_id: string; step: string; status: "running" | "done" | "skipped" | "failed";
  detail: Record<string, unknown>; attempt: number; created_at: string;
}
export interface Survey {
  id: string;
  inference_provider?: "kaggle" | "aws" | "kaggle_yolo26";
  name: string;
  location: string;
  captured_at: string;
  camera: string;
  status: JobState;
  photos: number;
  expected_assets?: number;
  severity: Severity;
  lat: number | null;
  lng: number | null;
  location_status?: "verified" | "extracted" | "needs_review" | "missing";
  progress?: number;
  stage_updated_at?: string;
  active_result_revision?: number | null;
  approved_result_revision?: number | null;
  note?: string;
  crop_stage?: "unknown" | "seedling" | "vegetative" | "reproductive" | "ripening" | "post_harvest";
  field_conditions?: ("standing_water" | "lodging" | "dry_or_cracked_soil" | "nutrient_stress_suspected" | "pest_damage_suspected")[];
  /** Kung may patubig (irrigated) o umaasa sa ulan (rainfed); nire-record sa upload. */
  irrigation?: "unknown" | "irrigated" | "rainfed";
  rice_variety?: string | null;
  auto_status?: AutoStatus | null;
  auto_mode?: "initial" | "verify";
  auto_error?: string | null;
  auto_attempts?: number;
  place?: Place | null;
  severity_detail?: SeverityDetail | null;
  location_source?: "exif_median" | "manual_pin" | "none";
  created_at?: string;
  pre_review?: { approved: true; classifier?: string | null; removed_photos?: number; approved_at?: string } | null;
  field_assessment?: { basis: "manual_field_assessment" | "reviewed_severity_assessment"; model_calibrated: false; result_revision: number; bulletin_id?: string; evidence_key?: string; diseases: Record<string, { category: string; basis?: string; leaf_area_affected_pct?: number; sampled_leaves?: number; specialist: string; notes: string }> };
}
export interface Bulletin {
  location_review?: { mode: "approximate_pin" | "no_pin"; lat: number | null; lng: number | null; evidence_key: string } | null;
  context_review_required?: boolean;
  media_approved?: boolean;
  severity_recommendation?: { basis: string; model_calibrated: false; scope: string; result_revision: number; advisory_revision: number; image_count: number; diseases: { disease: Disease; category: Severity; reason: string }[] } | null;
  id: string;
  survey_id?: string;
  slug: string;
  title: string;
  location: string;
  disease: Disease;
  severity: Severity;
  body: string;
  diseases?: Disease[];
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
  public_location_approved?: boolean;
  media?: PublicPhoto[];
  public_media?: PublicPhoto[];
  verification_status?: "unverified" | "verified" | "corrected" | "retracted";
  verified_at?: string | null;
  auto_generated?: boolean;
  severity_detail?: SeverityDetail | null;
  place?: Place | null;
  revision?: number;
  advisory_revision?: number;
  result_revision?: number | null;
  advisory_sources?: Array<{ disease: string; title: string; version: string; reference: string } | WebSource>;
  advisory_source_ids?: string[];
  limitations?: string;
  correction_note?: string | null;
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
    | "suppressed"
    | "mixed";
  sample: boolean;
  counts?: Partial<Record<"queued" | "accepted" | "sent" | "delivered" | "failed" | "unknown" | "suppressed", number>>;
  accepted_at?: string | null;
  delivered_at?: string | null;
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
  /** First-step classifier percentages saved when the photo was approved for upload. */
  classification?: { model: string; probs: Record<string, number>; top: string; uncertain: boolean; tiles: number | null } | null;
  /** Gemma 4's pre-upload look at the photo: crop stage and likely conditions. */
  llm_insight?: { model: string; crop_stage: string; conditions: Array<{ name: string; confidence: number }>; summary: string; is_rice_field: boolean; quality: string } | null;
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
  provider?: "kaggle" | "kaggle_yolo26" | "aws" | "roboflow_azure";
  stage?: string;
  estimated_credits?: number;
  review_urls?: Record<string, Record<string, string>>;
  finding_reviews?: { source_asset_id: string; disease: Disease; decision: "accepted" | "rejected" | "uncertain"; reason?: string | null; note?: string | null }[];
  created_at: string;
  updated_at: string;
  dispatched_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  provider_state?: string | null;
}
export interface ProviderStatus {
  inference?: "ready" | "configuration_required" | "waiting_for_allowance";
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
  pipeline_steps?: PipelineStep[];
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

export const IRRIGATION_LABEL: Record<NonNullable<Survey["irrigation"]>, string> = {
  unknown: "Hindi alam", irrigated: "May patubig (irrigated)", rainfed: "Umaasa sa ulan (rainfed)",
};
/** Karaniwang barayti sa Region II; puwedeng mag-type ng iba. */
export const COMMON_RICE_VARIETIES = [
  "NSIC Rc 222", "NSIC Rc 216", "NSIC Rc 160", "NSIC Rc 480", "NSIC Rc 402", "NSIC Rc 354",
  "PSB Rc 18", "PSB Rc 82", "Hybrid (SL-8H, Mestiso, atbp.)", "Inbred (hindi alam ang pangalan)",
];
