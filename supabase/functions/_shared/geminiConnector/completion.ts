import { catalogueSchema } from "./visualMedia.ts";

type Job = {
  id: string;
  survey_id: string;
  run_id: string;
  provider: string;
  result_manifest: unknown;
};
type Rpc = (
  name: string,
  args: { p_operation: string; p_input: unknown },
) => PromiseLike<{ data: unknown; error: unknown }>;
type Control = {
  action: "signed-pinned-uploads" | "verify-pinned-artifacts";
  job_id: string;
  run_id: string;
  artifacts: Record<string, { sha256: string; bytes: number }>;
};
const record = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" && !Array.isArray(x)
    ? x as Record<string, unknown>
    : {};
function batches(
  job: Job,
  action: Control["action"],
  artifacts: Control["artifacts"],
) {
  const out: Control[] = [];
  let current: Control["artifacts"] = {};
  for (const [path, receipt] of Object.entries(artifacts)) {
    const next = { ...current, [path]: receipt };
    if (
      new TextEncoder().encode(
          JSON.stringify({
            action,
            job_id: job.id,
            run_id: job.run_id,
            artifacts: next,
          }),
        ).length > 7000 || Object.keys(next).length > 20
    ) {
      if (!Object.keys(current).length) {
        throw new Error("Advisory control request exceeds limit");
      }
      out.push({
        action,
        job_id: job.id,
        run_id: job.run_id,
        artifacts: current,
      });
      current = { [path]: receipt };
    } else current = next;
  }
  if (Object.keys(current).length) {
    out.push({
      action,
      job_id: job.id,
      run_id: job.run_id,
      artifacts: current,
    });
  }
  return out;
}
/** Called only after the callback authenticates the exact run-scoped worker. */
export async function handleAdvisoryMedia(
  action: "prepare-advisory-media" | "complete-advisory-media",
  job: Job,
  payload: unknown,
  deps: {
    rpc: Rpc;
    control: (payload: Control) => Promise<Record<string, unknown>>;
    notify?: (eventId: string) => Promise<{ status: string }>;
  },
): Promise<Record<string, unknown>> {
  const parsed = catalogueSchema.safeParse(record(payload).catalogue);
  if (
    !parsed.success || job.provider !== "kaggle_yolo26" ||
    record(job.result_manifest).schema_version !== "riceguard.result.v2"
  ) throw new Error("Completed pinned result required for advisory media");
  const catalogue = parsed.data;
  if (catalogue.job_id !== job.id || catalogue.survey_id !== job.survey_id) {
    throw new Error("Advisory media does not match this job");
  }
  const rpc = async (name: string, op: string, input: unknown) => {
    const result = await deps.rpc(name, { p_operation: op, p_input: input });
    if (
      result.error || !result.data || typeof result.data !== "object" ||
      Array.isArray(result.data)
    ) throw new Error("Private advisory persistence denied");
    return record(result.data);
  };
  // SQL validates exact native source hashes, run paths, current revision and
  // complete photo pairs before ANY signed PUT or private sidecar insertion.
  const validated = await rpc("rg_mcp_visual_store", "validate_catalogue", {
    catalogue,
  });
  if (validated.valid !== true) {
    throw new Error("Advisory catalogue validation failed");
  }
  const artifacts = Object.fromEntries(
    catalogue.entries.map(
      (e) => [e.path, { sha256: e.sha256, bytes: e.bytes }],
    ),
  );
  if (action === "prepare-advisory-media") {
    const urls: Record<string, string> = {};
    for (const request of batches(job, "signed-pinned-uploads", artifacts)) {
      const signed = record((await deps.control(request)).private_uploads);
      if (
        Object.keys(signed).length !== Object.keys(request.artifacts).length
      ) throw new Error("Incomplete advisory upload authorization");
      for (const path of Object.keys(request.artifacts)) {
        if (
          typeof signed[path] !== "string" ||
          !signed[path].startsWith("https://")
        ) throw new Error("Missing advisory upload authorization");
        urls[path] = signed[path];
      }
    }
    return { private_uploads: urls };
  }
  for (const request of batches(job, "verify-pinned-artifacts", artifacts)) {
    const proof = await deps.control(request);
    if (
      proof.verified !== true ||
      proof.artifact_count !== Object.keys(request.artifacts).length
    ) throw new Error("Advisory image storage verification failed");
  }
  const saved = await rpc("rg_mcp_visual_store", "save_catalogue", {
    catalogue,
  });
  if (saved.stored !== true) {
    throw new Error("Advisory catalogue was not stored");
  }
  const event = await rpc("rg_mcp_event_store", "enqueue_ready", {
    survey_id: catalogue.survey_id,
    job_id: catalogue.job_id,
    result_revision: catalogue.result_revision,
    policy_version: catalogue.policy_version,
  });
  let notification: { status: string } | undefined;
  if (
    deps.notify && typeof event.event_id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      .test(event.event_id)
  ) {
    try {
      notification = await deps.notify(event.event_id);
    } catch {
      notification = { status: "unavailable" };
    }
  }
  return { ...saved, event, ...(notification ? { notification } : {}) };
}
