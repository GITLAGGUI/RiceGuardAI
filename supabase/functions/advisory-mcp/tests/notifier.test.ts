import assert from "node:assert/strict";
import {
  createNotifierHandler,
  drainNotices,
} from "../../_shared/geminiConnector/notifier.ts";
const a = "11111111-0000-4000-8000-000000000001",
  b = "11111111-0000-4000-8000-000000000002";
Deno.test("retry consumer drains bounded IDs once using the same persisted identities", async () => {
  const sent: string[] = [];
  const result = await drainNotices({
    list: async () => [{ event_id: a }, { event_id: b }],
    notify: async (id) => {
      sent.push(id);
      return { status: id === a ? "notified" : "requires_action" };
    },
  });
  assert.deepEqual(sent, [a, b]);
  assert.deepEqual(result, {
    checked: 2,
    notified: 1,
    requires_action: 1,
    pending: 0,
  });
});
Deno.test("malformed/oversized candidate lists fail before any transport", async () => {
  for (
    const list of [[{ event_id: "bad" }], Array(4).fill({ event_id: a }), [{
      event_id: a,
    }, { event_id: a }], [{ event_id: a, recipient: "injected" }]]
  ) {
    let sent = 0;
    await assert.rejects(() =>
      drainNotices({
        list: async () => list,
        notify: async () => {
          sent++;
          return { status: "notified" };
        },
      })
    );
    assert.equal(sent, 0);
  }
});
Deno.test("one failed event does not strand the next and never retries inline", async () => {
  const sent: string[] = [];
  const result = await drainNotices({
    list: async () => [{ event_id: a }, { event_id: b }],
    notify: async (id) => {
      sent.push(id);
      if (id === a) throw new Error("private detail");
      return { status: "notified" };
    },
  });
  assert.deepEqual(sent, [a, b]);
  assert.equal(result.pending, 1);
  assert.equal(result.notified, 1);
});
Deno.test("notifier endpoint requires cron bearer and feature flag before listing", async () => {
  let calls = 0;
  const deps = {
    list: async () => {
      calls++;
      return [];
    },
    notify: async () => ({ status: "notified" }),
  };
  const handler = createNotifierHandler({
    secret: "synthetic-private-cron",
    enabled: true,
    ...deps,
  });
  assert.equal(
    (await handler(new Request("https://example.test", { method: "POST" })))
      .status,
    401,
  );
  assert.equal(
    (await handler(
      new Request("https://example.test", {
        method: "GET",
        headers: { authorization: "Bearer synthetic-private-cron" },
      }),
    )).status,
    405,
  );
  assert.equal(calls, 0);
  const off = createNotifierHandler({
    secret: "synthetic-private-cron",
    enabled: false,
    ...deps,
  });
  assert.equal(
    (await off(
      new Request("https://example.test", {
        method: "POST",
        headers: { authorization: "Bearer synthetic-private-cron" },
      }),
    )).status,
    503,
  );
  assert.equal(calls, 0);
  const ok = await handler(
    new Request("https://example.test", {
      method: "POST",
      headers: { authorization: "Bearer synthetic-private-cron" },
    }),
  );
  assert.equal(ok.status, 200);
  assert.equal(calls, 1);
});
