/**
 * First-step photo classifier, run in the uploader's browser before anything is uploaded.
 *
 * Mirrors training (training_runs/photo_classifier): the photo is decoded at half resolution,
 * cut into 512 px tiles at stride 384, each tile resized to the model input (384) and
 * ImageNet-normalised. The photo's percentages are the mean softmax over the tiles.
 * The model is published as static parts listed in a manifest and checked by SHA-256.
 * Scoring runs in photoClassifier.worker.ts so the page stays responsive.
 */

export const PHOTO_CLASSES = ["BLB", "Brown Spot", "Soil Nitrogen"] as const;
export type PhotoClass = (typeof PHOTO_CLASSES)[number];
export interface PhotoClassification {
  model: string;
  probs: Record<PhotoClass, number>;
  top: PhotoClass;
  uncertain: boolean;
  tiles: number;
}
interface Manifest {
  model: string;
  classes: string[];
  input_size: number;
  tile: number;
  stride: number;
  scale: number;
  parts: string[];
  sha256: string;
  uncertain_below?: number;
  precision?: "fp32" | "int8";
  max_tiles?: number;
}

const MANIFEST_URL = import.meta.env.VITE_PHOTO_CLASSIFIER_MANIFEST || "/models/photo-classifier/manifest.json";

type Pending = { resolve: (value: { probs: number[]; tiles: number }) => void; reject: (error: Error) => void };
let loading: Promise<{ worker: Worker; manifest: Manifest } | null> | null = null;
const pending = new Map<number, Pending>();
let nextId = 1;

/** Loads the model once (in a worker). Resolves to null when no classifier is published yet. */
export function loadPhotoClassifier() {
  loading ||= (async () => {
    const response = await fetch(MANIFEST_URL, { cache: "no-cache", signal: AbortSignal.timeout(30000) });
    if (!response.ok) return null;
    const manifest = (await response.json()) as Manifest;
    if (manifest.classes.join("|") !== PHOTO_CLASSES.join("|")) throw new Error("Classifier classes do not match this website");
    if (!Number.isInteger(manifest.input_size) || manifest.input_size < 32 || manifest.input_size > 1024 ||
        !Number.isInteger(manifest.tile) || manifest.tile < 32 || manifest.tile > 4096 ||
        !Number.isInteger(manifest.stride) || manifest.stride < 1 || manifest.stride > manifest.tile ||
        !Number.isFinite(manifest.scale) || manifest.scale <= 0 || manifest.scale > 1 ||
        !Array.isArray(manifest.parts) || !manifest.parts.length || !/^[a-f0-9]{64}$/i.test(manifest.sha256))
      throw new Error("Classifier manifest is invalid");
    const worker = new Worker(new URL("./photoClassifier.worker.ts", import.meta.url), { type: "module" });
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (event) => {
        const data = event.data as { type: string; id?: number; error?: string; probs?: number[]; tiles?: number };
        if (data.type === "ready") resolve();
        else if (data.type === "result" && data.id) { pending.get(data.id)?.resolve({ probs: data.probs!, tiles: data.tiles! }); pending.delete(data.id); }
        else if (data.type === "error") {
          const error = new Error(data.error || "Classifier failed");
          if (data.id) { pending.get(data.id)?.reject(error); pending.delete(data.id); } else reject(error);
        }
      };
      worker.onerror = (event) => reject(new Error(event.message || "Classifier worker failed to start"));
      worker.postMessage({ type: "load", manifest, manifestUrl: new URL(MANIFEST_URL, window.location.href).toString() });
    });
    return { worker, manifest };
  })().catch((error) => { loading = null; throw error; });
  return loading;
}

export async function classifyPhoto(file: File): Promise<PhotoClassification | null> {
  const loaded = await loadPhotoClassifier();
  if (!loaded) return null;
  const { worker, manifest } = loaded;
  const id = nextId++;
  const result = await new Promise<{ probs: number[]; tiles: number }>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ type: "classify", id, file });
  });
  const probs = Object.fromEntries(PHOTO_CLASSES.map((name, c) => [name, result.probs[c]])) as Record<PhotoClass, number>;
  const top = PHOTO_CLASSES.reduce((a, b) => (probs[b] > probs[a] ? b : a));
  return { model: manifest.model, probs, top, uncertain: probs[top] < (manifest.uncertain_below ?? 0.6), tiles: result.tiles };
}
