type Rpc = (
  name: string,
  args: { p_operation: string; p_input: unknown },
) => PromiseLike<{ data: unknown; error: unknown }>;
type Deps = {
  endpoint: string;
  secret: string;
  rpc: Rpc;
  now: () => Date;
  randomUUID: () => string;
  fetcher?: typeof fetch;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const record = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" && !Array.isArray(x)
    ? x as Record<string, unknown>
    : {};
function relayUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === "script.google.com" &&
      !u.port && !u.username && !u.password && !u.search && !u.hash &&
      /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname);
  } catch {
    return false;
  }
}
async function responseBody(
  response: Response,
): Promise<Record<string, unknown>> {
  if (!response.ok || !response.body) throw new Error("provider_rejected");
  const reader = response.body.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 2048) throw new Error("provider_rejected");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return record(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
}
/** One bounded send attempt. A receipt means MailApp acceptance, not inbox or Task execution. */
export async function notifyReadyEvent(
  eventId: string,
  deps: Deps,
): Promise<
  {
    status:
      | "disabled"
      | "unavailable"
      | "notified"
      | "failed"
      | "requires_action";
  }
> {
  if (!relayUrl(deps.endpoint) || !/^[a-f0-9]{64}$/.test(deps.secret)) {
    return { status: "disabled" };
  }
  if (!uuid.test(eventId)) return { status: "unavailable" };
  const leaseId = deps.randomUUID();
  if (!uuid.test(leaseId)) return { status: "unavailable" };
  const call = async (op: string, input: unknown) => {
    const r = await deps.rpc("rg_mcp_event_store", {
      p_operation: op,
      p_input: input,
    });
    if (r.error) throw new Error("persistence_unavailable");
    return record(r.data);
  };
  let claimed: Record<string, unknown>;
  try {
    claimed = await call("claim_notice", {
      event_id: eventId,
      lease_id: leaseId,
    });
  } catch {
    return { status: "unavailable" };
  }
  if (claimed.event_id !== eventId) return { status: "unavailable" };
  if (claimed.status === "notified") return { status: "notified" };
  const expires = Date.parse(String(claimed.lease_expires_at));
  if (
    claimed.status !== "leased" || claimed.lease_id !== leaseId ||
    !Number.isFinite(expires) || expires <= deps.now().getTime()
  ) return { status: "unavailable" };
  let failure = "transport_unavailable";
  let requiresAction = false;
  try {
    const issued_at = Math.floor(deps.now().getTime() / 1000);
    const version = "riceguard.advisory.notice.v1", purpose = "advisory_ready";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(deps.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signed = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(
        `riceguard.apps-script.notice-relay.v1\n${version}\n${purpose}\n${issued_at}\n${eventId}`,
      ),
    );
    const signature = Array.from(
      new Uint8Array(signed),
      (x) => x.toString(16).padStart(2, "0"),
    ).join("");
    const signal = AbortSignal.timeout(8000), fetcher = deps.fetcher ?? fetch;
    let response = await fetcher(deps.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version,
        purpose,
        event_id: eventId,
        issued_at,
        signature,
      }),
      redirect: "manual",
      signal,
    });
    // ContentService serves output through a one-time Google URL. Never forward
    // the authenticated POST to a redirect, and never follow an arbitrary host.
    if (response.status === 302 || response.status === 303) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      const u = new URL(location ?? "");
      if (
        u.protocol !== "https:" ||
        u.hostname !== "script.googleusercontent.com" || u.port || u.username ||
        u.password || u.hash || u.pathname !== "/macros/echo"
      ) throw new Error("provider_rejected");
      response = await fetcher(u.href, {
        method: "GET",
        redirect: "manual",
        signal,
      });
    }
    failure = "provider_rejected";
    const receipt = await responseBody(response);
    requiresAction = receipt.ok === false &&
      receipt.error === "manual_reconciliation";
    if (requiresAction) failure = "manual_reconciliation";
    if (
      Object.keys(receipt).sort().join(",") !==
        "event_id,ok,provider_receipt,status" ||
      receipt.ok !== true || receipt.event_id !== eventId ||
      !["sent", "duplicate"].includes(String(receipt.status)) ||
      receipt.provider_receipt !== `apps-script:${eventId}`
    ) throw new Error("provider_rejected");
    // Lost DB acknowledgement can be retried using the same stable event ID;
    // the relay's receipt cache avoids a second MailApp send within retention.
    const ack = await call("ack_notice", {
      event_id: eventId,
      lease_id: leaseId,
      provider_receipt: receipt.provider_receipt,
    });
    if (ack.event_id !== eventId || ack.status !== "notified") {
      throw new Error("persistence_unavailable");
    }
    return { status: "notified" };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) failure = "transport_timeout";
    // Bounded codes only: no response bodies, endpoint, signatures or secrets.
    try {
      await call("record_failed", {
        event_id: eventId,
        lease_id: leaseId,
        failure_code: failure,
      });
    } catch {
      /* lease may already be acknowledged; preserve persisted truth */
    }
    return { status: requiresAction ? "requires_action" : "failed" };
  }
}
