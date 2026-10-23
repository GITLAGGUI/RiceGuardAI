import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { createVisualMediaReader } from "../../_shared/geminiConnector/visualMedia.ts";
import type { GrantContext } from "../../_shared/geminiConnector/contracts.ts";
import type { ConnectorStore } from "../../_shared/geminiConnector/store.ts";

const key = {
  survey_id: "11111111-0000-4000-8000-000000000001",
  job_id: "33333333-0000-4000-8000-000000000001",
  result_revision: 1,
};
const context: GrantContext = {
  grant_id: "g",
  owner_id: "o",
  scopes: ["evidence:read", "advisory:submit"],
  allow_images: true,
  expires_at: "2026-11-01T00:00:00Z",
};
function chunk(type: string, data: Uint8Array) {
  const b = new Uint8Array(data.length + 12), v = new DataView(b.buffer);
  v.setUint32(0, data.length);
  b.set(new TextEncoder().encode(type), 4);
  b.set(data, 8);
  let crc = 0xffffffff;
  for (const x of b.subarray(4, -4)) {
    crc ^= x;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  v.setUint32(b.length - 4, (crc ^ 0xffffffff) >>> 0);
  return b;
}
const png = Uint8Array.from([
  137,
  80,
  78,
  71,
  13,
  10,
  26,
  10,
  ...chunk("IHDR", Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0)),
  ...chunk("IDAT", deflateSync(Uint8Array.of(0, 0, 0, 0, 255))),
  ...chunk("IEND", new Uint8Array()),
]);
const sha = createHash("sha256").update(png).digest("hex");
const catalogueSha = "a".repeat(64);
function fixture(count = 4) {
  const run = "rg-synthetic1234",
    prefix = `website-inference/v2/jobs/${run}/outputs/`;
  const assets: Record<string, unknown>[] = [],
    entries: Record<string, unknown>[] = [];
  const artifacts: Record<string, unknown> = {};
  for (let i = 1; i <= count; i++) {
    const id = `55555555-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const paths = Object.fromEntries(
      ["original", "combined"].map(
        (v) => [v, `${prefix}native/${id}/${v}.jpg`],
      ),
    );
    assets.push({ kind: "image", source_asset_id: id, review_paths: paths });
    for (const variant of ["original", "combined"]) {
      artifacts[paths[variant]] = { sha256: "b".repeat(64), bytes: 2_200_000 };
      entries.push({
        source_asset_id: id,
        image_index: i,
        variant,
        source_sha256: "b".repeat(64),
        path: `${prefix}advisory-media/visual-v1/${id}/${variant}.jpg`,
        sha256: sha,
        bytes: png.length,
        width: 1,
        height: 1,
        quality: 85,
      });
    }
  }
  const catalogue = {
    schema_version: "riceguard.advisory.catalogue.v1",
    policy_version: "visual-v1",
    ...key,
    entries,
  };
  const calls: string[] = [],
    fetched: string[] = [],
    delivered = new Set<string>();
  const row = {
    revision: { ...key, revision: 1, manifest: { assets, artifacts } },
    job: { id: key.job_id, run_id: run },
    survey: {},
    guidance: [],
    evidence_binding_sha256: "c".repeat(64),
  };
  const store = {
    execute: async (op: { op: string; input: Record<string, unknown> }) => {
      calls.push(op.op);
      if (op.op === "read_evidence") return row;
      if (op.op === "read_visual_catalogue") {
        return { catalogue, catalogue_sha256: catalogueSha };
      }
      if (op.op === "record_visual_delivery") {
        for (const id of op.input.image_ids as string[]) delivered.add(id);
        return { recorded: true };
      }
      if (op.op === "assert_visual_delivery") {
        if (delivered.size !== entries.length) {
          throw new Error("Missing served images");
        }
        return { complete: true };
      }
      throw new Error("Unexpected operation");
    },
  } as unknown as ConnectorStore;
  const reader = createVisualMediaReader({
    store,
    allowedHosts: ["media.example.test"],
    sign: async (payload) =>
      Object.fromEntries(
        payload.paths.map((p) => [p, "https://media.example.test/review"]),
      ),
    fetcher: async (url) => {
      fetched.push(String(url));
      return new Response(png);
    },
  });
  return { reader, row, catalogue, calls, fetched, delivered };
}
Deno.test("visual catalogue contains all original/overlay pairs without private paths", async () => {
  for (const count of [1, 4, 10]) {
    const f = fixture(count), c = await f.reader.catalogue(context, key);
    assert.equal(c.expected_images, count * 2);
    assert.equal(c.images.length, count * 2);
    assert.equal(c.catalogue_sha256, catalogueSha);
    assert.equal(JSON.stringify(c).includes("website-inference"), false);
    assert.equal(f.fetched.length, 0);
  }
});
Deno.test("paging serves every photo pair and records delivery before visual submission", async () => {
  const f = fixture(4);
  await assert.rejects(() =>
    f.reader.assertDelivered(context, {
      ...key,
      catalogue_sha256: catalogueSha,
    })
  );
  let offset: number | null = 0;
  const ids = new Set<string>();
  while (offset !== null) {
    const page = await f.reader.read(context, {
      ...key,
      catalogue_sha256: catalogueSha,
      offset,
    });
    assert.equal(page.images.length, 2);
    assert.equal(page.expected_images, 8);
    for (const item of page.images) {
      ids.add(item.image_id);
      assert.equal(item.sha256, sha);
    }
    offset = page.next_offset;
  }
  assert.equal(ids.size, 8);
  assert.equal(f.fetched.length, 8);
  await f.reader.assertDelivered(context, {
    ...key,
    catalogue_sha256: catalogueSha,
  });
});
Deno.test("unconsented or stale visual reads never fetch images", async () => {
  const f = fixture();
  await assert.rejects(() =>
    f.reader.catalogue({ ...context, allow_images: false }, key)
  );
  assert.equal(f.calls.length, 0);
  await assert.rejects(() =>
    f.reader.read(context, {
      ...key,
      catalogue_sha256: "f".repeat(64),
      offset: 0,
    })
  );
  await assert.rejects(() =>
    f.reader.read(context, {
      ...key,
      catalogue_sha256: catalogueSha,
      offset: 1,
    })
  );
  assert.equal(f.fetched.length, 0);
});
Deno.test("partial catalogue, wrong source, foreign path and oversized receipt fail closed", async () => {
  for (
    const corrupt of [
      (f: ReturnType<typeof fixture>) => f.catalogue.entries.pop(),
      (f: ReturnType<typeof fixture>) => {
        f.catalogue.entries[0].source_sha256 = "e".repeat(64);
      },
      (f: ReturnType<typeof fixture>) => {
        f.catalogue.entries[0].path = "https://evil.invalid/private.jpg";
      },
      (f: ReturnType<typeof fixture>) => {
        f.catalogue.entries[0].bytes = 786433;
      },
      (f: ReturnType<typeof fixture>) => {
        f.catalogue.entries[0].image_index = 9;
      },
    ]
  ) {
    const f = fixture();
    corrupt(f);
    await assert.rejects(() => f.reader.catalogue(context, key));
    assert.equal(f.fetched.length, 0);
  }
});
Deno.test("actual raster dimensions must match the catalogue before delivery is recorded", async () => {
  const f = fixture();
  f.catalogue.entries[0].width = 2;
  await assert.rejects(() =>
    f.reader.read(context, {
      ...key,
      catalogue_sha256: catalogueSha,
      offset: 0,
    })
  );
  assert.equal(f.delivered.size, 0);
});
