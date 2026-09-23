import { handleCors, jsonResponse } from "../_shared/cors.ts";

// Compatibility endpoint. Advisory authoring now flows through
// generate-advisory so the exact result revision and approved specialist
// guidance are always bound to the draft.
Deno.serve((req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  return jsonResponse(
    { error: "Retired endpoint. Use generate-advisory with an approved RiceGuardAI bulletin revision." },
    410,
  );
});
