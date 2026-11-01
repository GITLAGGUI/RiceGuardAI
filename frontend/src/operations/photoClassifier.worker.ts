/// <reference lib="webworker" />
// Runs the browser photo classifier off the main thread, so the upload page never freezes while
// tiles are scored. Model bytes are cached in Cache Storage by their SHA-256 after the first download.
import type { InferenceSession } from "onnxruntime-web";

interface Manifest {
  model: string; classes: string[]; input_size: number; tile: number; stride: number; scale: number;
  parts: string[]; sha256: string; uncertain_below?: number; precision?: "fp32" | "int8"; max_tiles?: number;
}
type Request = { type: "load"; manifest: Manifest; manifestUrl: string } | { type: "classify"; id: number; file: Blob };

const ORT_VERSION = "1.22.0";
const CACHE = "rg-photo-classifier";
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
let session: InferenceSession | null = null;
let manifest: Manifest | null = null;

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function modelBytes(m: Manifest, base: URL) {
  const key = new URL(`model-${m.sha256}.onnx`, base).toString();
  try {
    const hit = await (await caches.open(CACHE)).match(key);
    if (hit) {
      const bytes = new Uint8Array(await hit.arrayBuffer());
      if (await sha256Hex(bytes) === m.sha256) return bytes;
    }
  } catch { /* Cache Storage unavailable: download instead */ }
  const parts = await Promise.all(m.parts.map(async (part) => {
    const r = await fetch(new URL(part, base), { cache: "force-cache", signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error(`Classifier file ${part} is unavailable`);
    return new Uint8Array(await r.arrayBuffer());
  }));
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { bytes.set(p, offset); offset += p.length; }
  if (await sha256Hex(bytes) !== m.sha256) throw new Error("Classifier file failed its integrity check");
  try {
    const cache = await caches.open(CACHE);
    for (const old of await cache.keys()) if (old.url !== key) await cache.delete(old);
    await cache.put(key, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }));
  } catch { /* quota or private window: download again next visit */ }
  return bytes;
}

function grid(length: number, tile: number, stride: number) {
  const last = Math.max(length - tile, 0);
  const starts: number[] = [];
  for (let v = 0; v <= last; v += stride) starts.push(v);
  if (starts[starts.length - 1] !== last) starts.push(last);
  return starts;
}

/** Evenly spaced subset so large photos stay quick. */
function spread<T>(items: T[], n: number) {
  if (items.length <= n) return items;
  return Array.from({ length: n }, (_, i) => items[Math.floor((i + 0.5) * items.length / n)]);
}

async function classify(file: Blob) {
  const ort = await import("onnxruntime-web/webgpu");
  const m = manifest!;
  const probe = await createImageBitmap(file);
  const width = Math.max(1, Math.floor(probe.width * m.scale)), height = Math.max(1, Math.floor(probe.height * m.scale));
  probe.close();
  const bitmap = await createImageBitmap(file, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
  const size = m.input_size;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.imageSmoothingQuality = "high";
  const tiles = spread(grid(height, m.tile, m.stride).flatMap((y) => grid(width, m.tile, m.stride).map((x) => [x, y] as const)), m.max_tiles || 24);
  const sum = new Array(m.classes.length).fill(0);
  for (let i = 0; i < tiles.length; i += 4) {
    const chunk = tiles.slice(i, i + 4);
    const input = new Float32Array(chunk.length * 3 * size * size);
    chunk.forEach(([x, y], k) => {
      context.drawImage(bitmap, x, y, Math.min(m.tile, width), Math.min(m.tile, height), 0, 0, size, size);
      const pixels = context.getImageData(0, 0, size, size).data;
      for (let c = 0; c < 3; c += 1) {
        const plane = (k * 3 + c) * size * size;
        for (let p = 0; p < size * size; p += 1) input[plane + p] = (pixels[p * 4 + c] / 255 - MEAN[c]) / STD[c];
      }
    });
    const output = await session!.run({ [session!.inputNames[0]]: new ort.Tensor("float32", input, [chunk.length, 3, size, size]) });
    const logits = output[session!.outputNames[0]].data as Float32Array;
    for (let k = 0; k < chunk.length; k += 1) {
      const row = Array.from(logits.slice(k * m.classes.length, (k + 1) * m.classes.length));
      const max = Math.max(...row);
      const exp = row.map((v) => Math.exp(v - max));
      const total = exp.reduce((a, b) => a + b, 0);
      exp.forEach((v, c) => { sum[c] += v / total; });
    }
  }
  bitmap.close();
  return { probs: sum.map((v) => v / tiles.length), tiles: tiles.length };
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const message = event.data;
  try {
    if (message.type === "load") {
      manifest = message.manifest;
      const bytes = await modelBytes(manifest, new URL(message.manifestUrl));
      const ort = await import("onnxruntime-web/webgpu");
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
      ort.env.wasm.numThreads = 1; // more threads would need a cross-origin-isolated page
      const providers = manifest.precision !== "int8" && "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"];
      session = await ort.InferenceSession.create(bytes, { executionProviders: providers, graphOptimizationLevel: "all" });
      self.postMessage({ type: "ready" });
    } else {
      self.postMessage({ type: "result", id: message.id, ...(await classify(message.file)) });
    }
  } catch (error) {
    self.postMessage({ type: "error", id: message.type === "classify" ? message.id : undefined, error: (error as Error).message || String(error) });
  }
};
