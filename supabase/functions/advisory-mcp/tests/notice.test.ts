import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { notifyReadyEvent } from "../../_shared/geminiConnector/notice.ts";
const id = "11111111-0000-4000-8000-000000000001";
const lease = "22222222-0000-4000-8000-000000000001";
const secret = "a".repeat(64);
const now = new Date("2026-10-23T00:00:00Z");
const endpoint = "https://script.google.com/macros/s/fixture_deployment/exec";
function fixture(mode = "ok") {
  const calls: string[] = [],
    requests: Array<{ url: string; init?: RequestInit }> = [];
  return {
    calls,
    requests,
    deps: {
      endpoint,
      secret,
      now: () => now,
      randomUUID: () => lease,
      rpc: async (
        _name: string,
        args: { p_operation: string; p_input: unknown },
      ) => {
        calls.push(args.p_operation);
        if (args.p_operation === "claim_notice") {
          return {
            data: {
              event_id: id,
              status: mode === "notified" ? "notified" : "leased",
              lease_id: mode === "notified" ? null : lease,
              lease_expires_at: "2026-10-23T00:05:00Z",
            },
            error: null,
          };
        }
        if (args.p_operation === "ack_notice") {
          return {
            data: { event_id: id, status: "notified" },
            error: null,
          };
        }
        if (args.p_operation === "record_failed") {
          return {
            data: { event_id: id, status: "failed" },
            error: null,
          };
        }
        throw new Error("unexpected");
      },
      fetcher: async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        if (mode === "throw") {
          throw new Error(
            "private failure must not leak",
          );
        }
        if (mode === "redirect") {
          return requests.length === 1
            ? new Response(null, {
              status: 302,
              headers: {
                location:
                  "https://script.googleusercontent.com/macros/echo?user_content_key=fixture",
              },
            })
            : new Response(
              JSON.stringify({
                ok: true,
                event_id: id,
                status: "sent",
                provider_receipt: "apps-script:" + id,
              }),
            );
        }
        if (mode === "foreign") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://evil.invalid/steal" },
          });
        }
        if (mode === "uncertain") return new Response(JSON.stringify({ok:false,error:"manual_reconciliation"}));
        return new Response(
          mode === "huge" ? "x".repeat(2049) : JSON.stringify({
            ok: true,
            event_id: mode === "wrong" ? lease : id,
            status: "sent",
            provider_receipt: "apps-script:" + id,
          }),
        );
      },
    },
  };
}
Deno.test("notice signs only an event hint, leases before send and acknowledges matching acceptance", async () => {
  const f = fixture();
  const result = await notifyReadyEvent(id, f.deps);
  assert.deepEqual(result, { status: "notified" });
  assert.deepEqual(f.calls, ["claim_notice", "ack_notice"]);
  const req = f.requests[0];
  assert.equal(req.init?.redirect, "manual");
  assert.equal(req.init?.method, "POST");
  const body = JSON.parse(String(req.init?.body));
  assert.deepEqual(
    Object.keys(body).sort(),
    ["version", "purpose", "event_id", "issued_at", "signature"].sort(),
  );
  assert.equal(
    body.signature,
    createHmac("sha256", secret).update(
      `riceguard.apps-script.notice-relay.v1\nriceguard.advisory.notice.v1\nadvisory_ready\n${
        Math.floor(now.getTime() / 1000)
      }\n${id}`,
    ).digest("hex"),
  );
  assert.ok(!String(req.init?.body).includes(secret));
});
Deno.test("ambiguous relay acceptance requires reconciliation, not a false notified receipt", async()=>{
 const f=fixture("uncertain");assert.deepEqual(await notifyReadyEvent(id,f.deps),{status:"requires_action"});
 assert.deepEqual(f.calls,["claim_notice","record_failed"]);assert.equal(f.requests.length,1);
});
Deno.test("already notified does not resend; missing config and invalid IDs do not claim", async () => {
  const f = fixture("notified");
  assert.deepEqual(await notifyReadyEvent(id, f.deps), { status: "notified" });
  assert.equal(f.requests.length, 0);
  const g = fixture();
  for (
    const deps of [{ ...g.deps, endpoint: "" }, { ...g.deps, secret: "bad" }, {
      ...g.deps,
      endpoint: "https://evil.invalid/exec",
    }]
  ) assert.deepEqual(await notifyReadyEvent(id, deps), { status: "disabled" });
  assert.deepEqual(await notifyReadyEvent("bad", g.deps), {
    status: "unavailable",
  });
  assert.equal(g.calls.length, 0);
});
Deno.test("Apps Script output redirect is GET-only and never forwards signed body", async () => {
  const f = fixture("redirect");
  assert.deepEqual(await notifyReadyEvent(id, f.deps), { status: "notified" });
  assert.equal(f.requests[1].init?.method, "GET");
  assert.equal(f.requests[1].init?.body, undefined);
  const g = fixture("foreign");
  assert.deepEqual(await notifyReadyEvent(id, g.deps), { status: "failed" });
  assert.equal(g.requests.length, 1);
});
Deno.test("foreign receipts, oversized responses and transport failures never acknowledge", async () => {
  for (const mode of ["wrong", "huge", "throw"]) {
    const f = fixture(mode);
    assert.deepEqual(await notifyReadyEvent(id, f.deps), { status: "failed" });
    assert.deepEqual(f.calls, ["claim_notice", "record_failed"]);
  }
});
