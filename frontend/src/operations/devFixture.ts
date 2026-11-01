// Dev-only layout fixture (served at /demo by `npm run dev`). Synthetic records shaped like the
// live automation: a survey waiting for the specialist, its job, published advisory and pipeline log.
import type { OperationsData, PipelineStep, Survey } from "./domain";
import { sampleData } from "./data";

const A = "aaaaaaaa-1111-4111-8111-000000000001";
const B = "aaaaaaaa-1111-4111-8111-000000000002";
const C = "aaaaaaaa-1111-4111-8111-000000000003";
const survey: Survey = {
  id: "demo-auto-01", name: "Poblacion 1, Santa Maria, Isabela · Nov 1, 2026", location: "Brgy. Poblacion 1, Santa Maria, Isabela",
  captured_at: "2026-10-31T16:20:00Z", created_at: "2026-10-31T16:22:07Z", camera: "Phone upload", status: "Needs review",
  photos: 3, severity: "low", lat: 17.459, lng: 121.75, inference_provider: "kaggle_yolo26", active_result_revision: 1,
  auto_status: "done", auto_mode: "initial", auto_attempts: 1,
  place: { method: "inside", label: "Brgy. Poblacion 1, Santa Maria, Isabela", barangay: "Poblacion 1", municipality: "Santa Maria", province: "Isabela" },
  severity_detail: {
    method: "representative_photo_ses_v1", formula: "lesion / plant", overall: "low", photos: 3, usable_photos: 3,
    diseases: {
      BLB: { percent: 6.35, ses_score: 3, category: "low", representative_asset_id: B, photo_number: 2, lesion_pixels: 865884, plant_pixels: 13634347, affected_photos: 2, usable_photos: 3 },
      "Brown Spot": { percent: 0.3, ses_score: 1, category: "low", representative_asset_id: A, photo_number: 1, lesion_pixels: 41000, plant_pixels: 13634347, affected_photos: 1, usable_photos: 3 },
    },
  },
};
const asset = (id: string, diseases: Array<["BLB" | "Brown Spot", number]>) => ({
  source_asset_id: id, kind: "image",
  diseases: (["BLB", "Brown Spot"] as const).map((d) => ({ disease: d, status: diseases.some(([x]) => x === d) ? "detected" : "not_detected" })),
  measurements: { plant_pixels: 1000, lesion_pixels: Object.fromEntries(diseases.map(([d, n]) => [d, n])) },
});
const t = (minutes: number) => new Date(Date.parse("2026-10-31T17:02:14Z") + minutes * 60_000).toISOString();
const steps: PipelineStep[] = [
  ["start", "running", {}], ["severity", "done", { overall: "low" }],
  ["location", "done", { label: "Brgy. Poblacion 1, Santa Maria, Isabela" }],
  ["error", "failed", { error: "Public media upload failed: storage returned an HTML error page", will_retry: true, retry_in_seconds: 15 }],
  ["start", "running", {}], ["severity", "done", { overall: "low" }], ["location", "done", { label: "Brgy. Poblacion 1, Santa Maria, Isabela" }],
  ["media", "done", { photos: 3 }], ["advisory", "done", { mode: "ollama", model: "gemma4:31b", sources: [1, 2, 3, 4] }],
  ["published", "done", { recipients: 5 }],
].map(([step, status, detail], i) => ({ id: i + 1, survey_id: survey.id, step: step as string, status: status as PipelineStep["status"],
  detail: detail as Record<string, unknown>, attempt: i < 4 ? 1 : 2, created_at: t(i < 4 ? i * 0.05 : 0.5 + i * 0.05) }));

const photo = "/images/blb.webp";
export const devFixture: OperationsData = {
  ...sampleData,
  surveys: [survey, ...sampleData.surveys],
  jobs: [{
    id: "demo-job-01", survey_id: survey.id, status: "Needs review", progress: 100, kaggle_kernel_ref: "demo/riceguard", run_id: "rg-demo",
    error: null, provider: "kaggle_yolo26", created_at: "2026-10-31T16:23:02Z", updated_at: "2026-10-31T17:02:10Z",
    result_manifest: { assets: [asset(A, [["BLB", 62], ["Brown Spot", 3]]), asset(B, [["BLB", 64]]), asset(C, [])] },
    review_urls: Object.fromEntries([A, B, C].map((id) => [id, { original: photo, web_original: photo, combined: photo, BLB: photo, "Brown Spot": photo }])),
  }],
  bulletins: [{
    id: "demo-bulletin-01", survey_id: survey.id, slug: "demo-poblacion-1", title: "Rice Field Health Advisory — Poblacion 1",
    location: survey.location, disease: "BLB", diseases: ["BLB", "Brown Spot"], severity: "low", body: "Halimbawang automated advisory.",
    action: "1. Suriin ang tubig sa palayan.", date: "2026-11-01", status: "published", image: photo, reviewer: null, sample: true,
    lat: survey.lat, lng: survey.lng, result_revision: 1, verification_status: "unverified", auto_generated: true,
  }, ...sampleData.bulletins],
  pipeline_steps: steps,
};
