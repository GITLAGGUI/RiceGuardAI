import { z } from "zod";
import type { ConnectorStore, GrantContext } from "./contracts.ts";
import { ConnectorError } from "./policy.ts";
const schema = z.object({
  event_id: z.uuid(),
  survey_id: z.uuid(),
  job_id: z.uuid(),
  result_revision: z.number().int().positive(),
  policy_version: z.literal("visual-v1"),
  catalogue_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["pending", "leased", "notified", "failed"]),
});
export type ReadyEvent = z.infer<typeof schema>;
/** An email is only an event hint; SQL remains the current-access authority. */
export async function resolveReadyEvent(
  context: GrantContext,
  eventId: string,
  store: ConnectorStore,
): Promise<ReadyEvent> {
  if (!context.allow_images || !context.scopes.includes("evidence:read")) {
    throw new ConnectorError("insufficient_scope", 403);
  }
  if (!z.uuid().safeParse(eventId).success) {
    throw new ConnectorError("invalid_event", 400);
  }
  const raw = await store.execute({
    op: "resolve_ready_event",
    input: { grant_id: context.grant_id, event_id: eventId },
  });
  const event = schema.safeParse(raw);
  if (!event.success || event.data.event_id !== eventId) {
    throw new ConnectorError("unavailable_event", 409);
  }
  return event.data;
}
