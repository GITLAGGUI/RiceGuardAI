import type { ConnectorDeps, GrantContext } from "./contracts.ts";
import { parseSubmission } from "./contracts.ts";
import { ConnectorError, hash } from "./policy.ts";
import { readEvidence } from "./evidence.ts";
import {
  type AdvisorySource,
  type DiseaseName,
  validateAdvisoryDraft,
} from "../advisoryEvidence.ts";
export async function submitAdvisory(
  context: GrantContext,
  raw: unknown,
  deps: ConnectorDeps,
) {
  if (!context.scopes.includes("advisory:submit")) {
    throw new ConnectorError("insufficient_scope", 403);
  }
  const parsed = parseSubmission(raw, deps.now());
  const { packet } = await readEvidence(context, parsed, deps);
  if (packet.evidence_sha256 !== parsed.evidence_sha256) {
    throw new ConnectorError(
      "stale_evidence",
      409,
      "Read the current evidence before submitting",
    );
  }
  if (deps.visual) {
    if (!packet.visual_catalogue) {
      throw new ConnectorError("visual_media_not_ready", 409);
    }
    await deps.visual.assertDelivered(context, {
      survey_id: parsed.survey_id,
      job_id: parsed.job_id,
      result_revision: parsed.result_revision,
      catalogue_sha256: packet.visual_catalogue.catalogue_sha256,
    });
  }
  const diseases = [
    ...new Set(
      packet.findings.filter((f) => f.status === "detected").map((f) =>
        f.disease
      ),
    ),
  ] as DiseaseName[];
  if (!diseases.length) {
    throw new ConnectorError(
      "no_target_finding",
      409,
      "Do not infer a disease from an empty result",
    );
  }
  const sources = packet.guidance.map((s) => ({
    id: String(s.id),
    disease: s.disease as DiseaseName,
    title: String(s.title),
    version: String(s.version),
    reference: String(s.reference),
    guidance: s,
  })) satisfies AdvisorySource[];
  const draft = validateAdvisoryDraft(parsed, sources, diseases);
  const payload = {
    ...parsed,
    ...draft,
    limitations: [
      ...new Set([
        "AI-generated; hindi pa na-review ng agricultural specialist.",
        ...draft.limitations,
      ]),
    ].slice(0, 8),
  };
  const input = {
    grant_id: context.grant_id,
    survey_id: parsed.survey_id,
    job_id: parsed.job_id,
    result_revision: parsed.result_revision,
    evidence_sha256: parsed.evidence_sha256,
    evidence_binding_sha256: packet.evidence_binding_sha256,
    idempotency_key: parsed.idempotency_key,
    payload_sha256: await hash(JSON.stringify(payload)),
    payload,
  };
  const receipt = deps.visual && packet.visual_catalogue
    ? await deps.store.execute({
      op: "save_visual_submission",
      input: {
        ...input,
        catalogue_sha256: packet.visual_catalogue.catalogue_sha256,
        policy_version: "visual-v1",
      },
    })
    : await deps.store.execute({ op: "save_submission", input });
  return receipt;
}
