import { handleCors, jsonResponse } from "../_shared/cors.ts";

// Legacy route retained so old clients fail clearly rather than creating a
// competing inference pipeline.
Deno.serve((req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  return jsonResponse(
    { error: "Retired endpoint. Create a survey through field-operations; verified batches are queued for private Kaggle inference." },
    410,
  );
});
