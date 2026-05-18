// STUB — Future YOLO inference pipeline.
//
// When you have a trained YOLOv8 .pt for rice_blast + BLB + tungro detection,
// this is where you wire it. Two recommended patterns:
//
//   A) Hosted inference (Roboflow / Replicate / HuggingFace Inference):
//      POST image bytes → response with bbox + class + confidence → insert detections.
//
//   B) Self-hosted ONNX in this function via onnxruntime-web (Deno-compatible):
//      Load .onnx weights from Supabase Storage, run inference in-process.
//      Bundle constraints: ~30s timeout, 50MB function size.
//
// For now this function returns 501 with a clear message, and the admin UI
// shows the "Run AI inference" button as disabled with a tooltip.

import { handleCors, jsonResponse } from "../_shared/cors.ts";

interface Body {
  scan_id: string;
  image_path: string; // storage path inside `scans` bucket
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid json" }, 400);
  }
  if (!body.scan_id || !body.image_path)
    return jsonResponse({ error: "scan_id + image_path required" }, 400);

  return jsonResponse(
    {
      ok: false,
      stub: true,
      message:
        "YOLO inference not yet integrated. Mark detections manually in the scan upload UI. " +
        "When a model is ready, wire either hosted inference (Roboflow/Replicate) or onnxruntime here.",
      next_steps: [
        "Train YOLOv8 on rice_blast + BLB + tungro classes",
        "Export to .onnx and upload to Supabase Storage `models` bucket",
        "Replace this stub with the inference call",
        "On success, INSERT into disease_detections with bbox_json + confidence_score",
      ],
    },
    501
  );
});
