import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { createEvidenceMediaReader } from "../../_shared/geminiConnector/media.ts";
import type { GrantContext } from "../../_shared/geminiConnector/contracts.ts";
import type {
  ConnectorStore,
  InternalEvidence,
  StoreOperation,
} from "../../_shared/geminiConnector/store.ts";

const key = {
  survey_id: "11111111-0000-4000-8000-000000000001",
  job_id: "33333333-0000-4000-8000-000000000001",
  result_revision: 1,
};
const context: GrantContext = {
  grant_id: "grant",
  owner_id: "owner",
  scopes: ["evidence:read"],
  allow_images: true,
  expires_at: "2026-11-01T00:00:00Z",
};
const safePng = Uint8Array.from([
  137,
  80,
  78,
  71,
  13,
  10,
  26,
  10,
  ...pngChunk("IHDR", Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0)),
  ...pngChunk("IDAT", deflateSync(Uint8Array.of(0, 0, 0, 0, 255))),
  ...pngChunk("IEND", new Uint8Array()),
]);
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const asset = (path = "private/run/image.png", sha = digest(safePng)) => ({
  kind: "image",
  source_asset_id: path,
  review_paths: { combined: path },
  review_sha256: { combined: sha },
});
function row(assets: unknown[] = [asset()]): InternalEvidence {
  return {
    revision: {
      ...key,
      revision: 1,
      manifest: { schema_version: "riceguard.result.v2", assets },
    },
    job: {
      id: key.job_id,
      run_id: "44444444-0000-4000-8000-000000000001",
      provider: "kaggle_yolo26",
    },
    survey: { id: key.survey_id },
    guidance: [],
    evidence_binding_sha256: "a".repeat(64),
  };
}
function fixture(
  options: {
    evidence?: InternalEvidence;
    url?: string;
    response?: () => Response | Promise<Response>;
  } = {},
) {
  const operations: StoreOperation[] = [],
    signed: unknown[] = [],
    fetched: { url: string; init: RequestInit | undefined }[] = [];
  const evidence = options.evidence ?? row();
  const store = {
    execute: async (operation: StoreOperation) => {
      operations.push(operation);
      assert.equal(operation.op, "read_evidence");
      return evidence;
    },
  } as ConnectorStore;
  const reader = createEvidenceMediaReader({
    store,
    allowedHosts: ["media.example.test"],
    sign: async (
      payload: {
        action: "signed-pinned-review";
        job_id: string;
        run_id: string;
        paths: string[];
      },
    ) => {
      signed.push(payload);
      return Object.fromEntries(
        payload.paths.map(
          (path) => [
            path,
            options.url ??
              "https://media.example.test/signed.png?signature=PRIVATE",
          ],
        ),
      );
    },
    fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
      fetched.push({ url: String(input), init });
      return await (options.response?.() ?? new Response(safePng));
    },
  });
  return { reader, operations, signed, fetched };
}

// Independent fixture constructor: PNG CRCs keep malformed metadata tests valid
// images at their byte-container boundary rather than merely broken signatures.
function pngChunk(type: string, data: Uint8Array) {
  const bytes = new Uint8Array(data.length + 12),
    view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}
function pngWithMetadata(type: string) {
  const metadata = pngChunk(
    type,
    new TextEncoder().encode("private GPS or instructions"),
  );
  const bytes = new Uint8Array(safePng.length + metadata.length);
  bytes.set(safePng.subarray(0, 33));
  bytes.set(metadata, 33);
  bytes.set(safePng.subarray(33), 33 + metadata.length);
  return bytes;
}
function readerForBytes(bytes: Uint8Array) {
  return fixture({
    evidence: row([asset("private/run/image.png", digest(bytes))]),
    response: () => new Response(new Uint8Array(bytes)),
  });
}

Deno.test("image permission off prevents database, signing and fetching", async () => {
  const f = fixture();
  assert.deepEqual(
    await f.reader.read({ ...context, allow_images: false }, key),
    [],
  );
  assert.deepEqual([f.operations.length, f.signed.length, f.fetched.length], [
    0,
    0,
    0,
  ]);
});
Deno.test("image retrieval requires evidence scope and exact authorized revision", async () => {
  const f = fixture();
  await assert.rejects(() => f.reader.read({ ...context, scopes: [] }, key));
  assert.equal(f.operations.length, 0);
  const stale = fixture({ evidence: row() });
  await assert.rejects(() =>
    stale.reader.read(context, { ...key, result_revision: 2 })
  );
  assert.equal(stale.signed.length, 0);
});
Deno.test("missing derivative hashes stay text-only without signing original paths", async () => {
  const f = fixture({
    evidence: row([{
      kind: "image",
      review_paths: {
        combined: "private/combined.png",
        original: "private/original.png",
      },
    }]),
  });
  assert.deepEqual(await f.reader.read(context, key), []);
  assert.equal(f.signed.length, 0);
  assert.equal(f.fetched.length, 0);
});
Deno.test("pinned manifest artifact receipts supply the exact review-image hash", async () => {
  const path = "private/run/combined.png";
  const evidence = row([{ kind: "image", review_paths: { combined: path } }]);
  evidence.revision.manifest = {
    ...(evidence.revision.manifest as Record<string, unknown>),
    artifacts: { [path]: { sha256: digest(safePng), bytes: safePng.length } },
  };
  const f = fixture({ evidence });
  const images = await f.reader.read(context, key);
  assert.equal(images.length, 1);
  assert.equal(images[0].sha256, digest(safePng));
  assert.deepEqual((f.signed[0] as { paths: string[] }).paths, [path]);
});
Deno.test("conflicting or malformed artifact receipts never authorize media", async () => {
  const path = "private/run/combined.png";
  for (
    const receipt of [
      { sha256: "b".repeat(64), bytes: safePng.length },
      { sha256: digest(safePng), bytes: 0 },
      { sha256: "invalid", bytes: safePng.length },
    ]
  ) {
    const evidence = row([asset(path)]);
    evidence.revision.manifest = {
      ...(evidence.revision.manifest as Record<string, unknown>),
      artifacts: { [path]: receipt },
    };
    const f = fixture({ evidence });
    await assert.rejects(() => f.reader.read(context, key));
    assert.equal(f.signed.length, 0);
    assert.equal(f.fetched.length, 0);
  }
});
Deno.test("valid safe PNG returns verified bytes and only two manifest-selected images", async () => {
  const f = fixture({
    evidence: row([
      asset(),
      {
        kind: "video",
        review_paths: { combined: "private/video.png" },
        review_sha256: { combined: digest(safePng) },
      },
      asset("private/run/second.png"),
      asset("private/run/third.png"),
    ]),
  });
  const images = await f.reader.read(
    context,
    {
      ...key,
      run_id: "attacker",
      path: "https://evil.test/image",
    } as typeof key,
  );
  assert.equal(images.length, 2);
  assert.equal(images[0].mimeType, "image/png");
  assert.equal(images[0].sha256, digest(safePng));
  assert.deepEqual(
    Uint8Array.from(atob(images[0].data), (c) => c.charCodeAt(0)),
    safePng,
  );
  assert.deepEqual(f.operations, [{
    op: "read_evidence",
    input: { grant_id: "grant", ...key },
  }]);
  assert.deepEqual(f.signed, [{
    action: "signed-pinned-review",
    job_id: key.job_id,
    run_id: "44444444-0000-4000-8000-000000000001",
    paths: ["private/run/image.png", "private/run/second.png"],
  }]);
  assert.equal(f.fetched.length, 2);
  assert.equal(f.fetched[0].init?.redirect, "error");
});
Deno.test("a hashed original derivative may be selected but unhashed variants never are", async () => {
  const original = {
    kind: "image",
    review_paths: {
      combined: "private/unhashed.png",
      original: "private/original.png",
    },
    review_sha256: { original: digest(safePng) },
  };
  const f = fixture({ evidence: row([original]) });
  assert.equal((await f.reader.read(context, key)).length, 1);
  assert.deepEqual((f.signed[0] as { paths: string[] }).paths, [
    "private/original.png",
  ]);
});
Deno.test("signed URLs reject foreign hosts, credentials, ports and insecure transport before fetching", async () => {
  for (
    const url of [
      "http://media.example.test/image",
      "https://evil.test/image",
      "https://media.example.test.evil.test/image",
      "https://media.example.test:443/image",
      "https://media.example.test:8443/image",
      "https://user:pass@media.example.test/image",
      "https://media.example.test/image#fragment",
    ]
  ) {
    const f = fixture({ url });
    await assert.rejects(() => f.reader.read(context, key), url);
    assert.equal(f.fetched.length, 0, url);
  }
});
Deno.test("redirect responses cannot follow a signer URL to another resource", async () => {
  const f = fixture({
    response: () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://evil.test/private" },
      }),
  });
  await assert.rejects(() => f.reader.read(context, key));
  assert.equal(f.fetched.length, 1);
  assert.equal(f.fetched[0].init?.redirect, "error");
});
Deno.test("a chunked response exceeding one MiB is cancelled immediately", async () => {
  let cancelled = false, pulls = 0;
  const f = fixture({
    response: () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array(600_000));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  await assert.rejects(() => f.reader.read(context, key));
  assert.equal(cancelled, true);
  assert.ok(pulls <= 3);
});
Deno.test("oversized Content-Length is rejected and its body is cancelled", async () => {
  let cancelled = false;
  const f = fixture({
    response: () =>
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "Content-Length": "1048577" } },
      ),
  });
  await assert.rejects(() => f.reader.read(context, key));
  assert.equal(cancelled, true);
});
Deno.test("PNG EXIF and text-bearing ancillary chunks are rejected even when their hash matches", async () => {
  for (const type of ["eXIf", "tEXt", "zTXt", "iTXt", "iCCP"]) {
    await assert.rejects(
      () => readerForBytes(pngWithMetadata(type)).reader.read(context, key),
      type,
    );
  }
});
Deno.test("JPEG EXIF, comments and unknown application metadata are rejected", async () => {
  for (const marker of [0xe1, 0xe2, 0xfe]) {
    const bytes = Uint8Array.of(
      0xff,
      0xd8,
      0xff,
      marker,
      0,
      6,
      69,
      120,
      105,
      102,
      0xff,
      0xd9,
    );
    await assert.rejects(() => readerForBytes(bytes).reader.read(context, key));
  }
});
Deno.test("malformed PNG/JPEG containers and trailing content cannot masquerade as complete images", async () => {
  const badCrc = safePng.slice();
  badCrc[29] ^= 1;
  for (
    const bytes of [
      safePng.subarray(0, -1),
      new Uint8Array([...safePng, 0]),
      badCrc,
      Uint8Array.of(0xff, 0xd8, 0xff, 0xd9),
    ]
  ) await assert.rejects(() => readerForBytes(bytes).reader.read(context, key));
});
Deno.test("fetched bytes must match the exact manifest derivative hash", async () => {
  const f = fixture({
    evidence: row([asset("private/run/image.png", "0".repeat(64))]),
  });
  await assert.rejects(() => f.reader.read(context, key));
});
