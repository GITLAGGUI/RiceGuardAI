type Deps = {
  list: () => Promise<unknown>;
  notify: (id: string) => Promise<{ status: string }>;
};
/** Bounded retries use persisted event IDs, never a new message identity. */
export async function drainNotices(deps: Deps) {
  const rows = await deps.list();
  const uuid =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  if (
    !Array.isArray(rows) || rows.length > 3 ||
    rows.some((r) =>
      !r || typeof r !== "object" || Object.keys(r).join() !== "event_id" ||
      !uuid.test(r.event_id)
    ) || new Set(rows.map((r) => r.event_id)).size !== rows.length
  ) throw new Error("Invalid notice candidate list");
  const result = {
    checked: rows.length,
    notified: 0,
    requires_action: 0,
    pending: 0,
  };
  for (const row of rows) {
    try {
      const status = (await deps.notify(row.event_id)).status;
      if (status === "notified") result.notified++;
      else if (status === "requires_action") result.requires_action++;
      else result.pending++;
    } catch {
      result.pending++;
    }
  }
  return result;
}
export function createNotifierHandler(
  deps: Deps & { enabled: boolean; secret: string },
) {
  return async (req: Request) => {
    const reply = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      });
    if (req.method !== "POST") {
      return reply({ error: "Method not allowed" }, 405);
    }
    const given = req.headers.get("authorization") || "",
      expected = `Bearer ${deps.secret}`;
    let mismatch = given.length ^ expected.length;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ (given.charCodeAt(i) || 0);
    }
    if (!deps.secret || mismatch) return reply({ error: "Unauthorized" }, 401);
    if (!deps.enabled) return reply({ error: "Notice consumer disabled" }, 503);
    try {
      return reply(await drainNotices(deps));
    } catch {
      return reply({ error: "Notice consumer unavailable" }, 503);
    }
  };
}
