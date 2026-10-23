import type {
  ConnectorStore,
  EvidenceImage,
  EvidenceMediaReader,
} from "./contracts.ts";
import { ConnectorError, hash, LIMITS } from "./policy.ts";

type SignPayload = {
  action: "signed-pinned-review";
  job_id: string;
  run_id: string;
  paths: string[];
};
export type MediaInput = {
  store: ConnectorStore;
  sign: (payload: SignPayload) => Promise<Record<string, string>>;
  allowedHosts: string[];
  fetcher?: typeof fetch;
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
const unsafe = () =>
  new ConnectorError(
    "unsafe_evidence_media",
    409,
    "A verified private image derivative is unavailable",
  );

function signedUrl(value: unknown, allowedHosts: ReadonlySet<string>): string {
  if (typeof value !== "string" || value.length > 8192) throw unsafe();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw unsafe();
  }
  // Comparing the raw authority also excludes an explicit default :443 port,
  // which URL.port normalizes away. Never follow signer responses off-host.
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (
    url.protocol !== "https:" || url.username || url.password || url.port ||
    url.hash ||
    authority?.toLowerCase() !== url.hostname || !allowedHosts.has(url.hostname)
  ) throw unsafe();
  return url.href;
}

async function boundedBytes(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  const length = response.headers.get("content-length");
  if (
    !response.ok || response.redirected ||
    (length !== null && (!/^\d+$/.test(length) || Number(length) > limit))
  ) {
    await response.body?.cancel();
    throw unsafe();
  }
  const reader = response.body?.getReader();
  if (!reader) throw unsafe();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw unsafe();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!size || (length !== null && size !== Number(length))) throw unsafe();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function png(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8,
    hasHeader = false,
    hasData = false,
    hasPalette = false,
    color = -1;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset), end = offset + 12 + length;
    if (end > bytes.length) throw unsafe();
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    // Only critical image chunks are accepted. Ancillary metadata, including
    // EXIF, text, compressed profiles and unknown extensions, stays private.
    if (!["IHDR", "PLTE", "IDAT", "IEND"].includes(type)) throw unsafe();
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, end - 4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
    }
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(end - 4)) throw unsafe();
    if (!hasHeader && type !== "IHDR") throw unsafe();
    if (type === "IHDR") {
      if (hasHeader || offset !== 8 || length !== 13) throw unsafe();
      const depth = bytes[offset + 16];
      color = bytes[offset + 17];
      const depths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !view.getUint32(offset + 8) || !view.getUint32(offset + 12) ||
        !depths[color]?.includes(depth) || bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 || bytes[offset + 20] > 1
      ) throw unsafe();
      hasHeader = true;
    } else if (type === "PLTE") {
      if (
        hasPalette || hasData || color === 0 || color === 4 || !length ||
        length % 3 || length > 768
      ) throw unsafe();
      hasPalette = true;
    } else if (type === "IDAT") {
      if (color === 3 && !hasPalette) throw unsafe();
      hasData = true;
    } else {
      if (length || !hasData || end !== bytes.length) throw unsafe();
      return true;
    }
    offset = end;
  }
  throw unsafe();
}

function jpeg(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2,
    frame = false,
    scan = false,
    quantization = false,
    huffman = false;
  const components = new Set<number>();
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw unsafe();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (
        !frame || !scan || !quantization || !huffman || offset !== bytes.length
      ) throw unsafe();
      return true;
    }
    if (
      ![0xe0, 0xc0, 0xc1, 0xc2, 0xc4, 0xdb, 0xdd, 0xda].includes(marker) ||
      offset + 2 > bytes.length
    ) throw unsafe();
    const length = (bytes[offset] << 8) | bytes[offset + 1],
      end = offset + length;
    if (length < 2 || end > bytes.length) throw unsafe();
    const body = bytes.subarray(offset + 2, end);
    if (marker === 0xe0) {
      // A plain JFIF header without thumbnail carries image formatting only.
      if (
        body.length !== 14 ||
        String.fromCharCode(...body.subarray(0, 5)) !== "JFIF\0" ||
        body[5] !== 1 || body[6] > 2 || body[7] > 2 || body[12] || body[13]
      ) throw unsafe();
    } else if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const count = body[5];
      if (
        frame || body[0] !== 8 || !((body[1] << 8) | body[2]) ||
        !((body[3] << 8) | body[4]) || !count || count > 4 ||
        body.length !== 6 + 3 * count
      ) throw unsafe();
      for (let i = 6; i < body.length; i += 3) {
        if (
          components.has(body[i]) || !(body[i + 1] >> 4) ||
          !(body[i + 1] & 15) || (body[i + 1] >> 4) > 4 ||
          (body[i + 1] & 15) > 4 || body[i + 2] > 3
        ) throw unsafe();
        components.add(body[i]);
      }
      frame = true;
    } else if (marker === 0xdb) {
      if (!body.length) throw unsafe();
      let at = 0;
      while (at < body.length) {
        const table = body[at++], precision = table >> 4;
        if (precision > 1 || (table & 15) > 3) throw unsafe();
        at += 64 * (precision + 1);
        if (at > body.length) throw unsafe();
      }
      quantization = true;
    } else if (marker === 0xc4) {
      if (!body.length) throw unsafe();
      let at = 0;
      while (at < body.length) {
        const table = body[at++];
        if ((table >> 4) > 1 || (table & 15) > 3 || at + 16 > body.length) {
          throw unsafe();
        }
        let count = 0;
        for (let i = 0; i < 16; i++) count += body[at++];
        if (!count || count > 256 || at + count > body.length) throw unsafe();
        at += count;
      }
      huffman = true;
    } else if (marker === 0xdd) { if (body.length !== 2) throw unsafe(); }
    else {
      const count = body[0];
      if (
        !frame || !count || count > components.size ||
        body.length !== 4 + 2 * count
      ) throw unsafe();
      const selected = new Set<number>();
      for (let i = 1; i < 1 + 2 * count; i += 2) {
        if (
          !components.has(body[i]) || selected.has(body[i]) ||
          (body[i + 1] >> 4) > 3 || (body[i + 1] & 15) > 3
        ) throw unsafe();
        selected.add(body[i]);
      }
      if (body[body.length - 3] > 63 || body[body.length - 2] > 63) {
        throw unsafe();
      }
      offset = end;
      let entropy = false;
      while (offset < bytes.length) {
        if (bytes[offset++] !== 0xff) {
          entropy = true;
          continue;
        }
        const start = offset - 1;
        while (bytes[offset] === 0xff) offset++;
        const next = bytes[offset];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) {
          offset++;
          entropy = true;
          continue;
        }
        offset = start;
        break;
      }
      if (!entropy) throw unsafe();
      scan = true;
      continue;
    }
    offset = end;
  }
  throw unsafe();
}

function imageType(bytes: Uint8Array): EvidenceImage["mimeType"] {
  if (png(bytes)) return "image/png";
  if (jpeg(bytes)) return "image/jpeg";
  throw unsafe();
}
function base64(bytes: Uint8Array): string {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(text);
}

/** Shared strict download boundary; never returns a private signed URL. */
export async function readVerifiedImage(
  href: unknown,
  receipt: { sha256: string; bytes: number; width: number; height: number },
  input: Pick<MediaInput, "allowedHosts" | "fetcher">,
): Promise<EvidenceImage> {
  if (
    !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
    !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 1 ||
    receipt.bytes > LIMITS.imageBytes ||
    !Number.isSafeInteger(receipt.width) ||
    !Number.isSafeInteger(receipt.height) ||
    receipt.width < 1 || receipt.height < 1 || receipt.width > 2048 ||
    receipt.height > 2048
  ) throw unsafe();
  const hosts = new Set(input.allowedHosts.map((h) => h.toLowerCase()));
  const url = signedUrl(href, hosts);
  const response = await (input.fetcher ?? fetch)(url, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (response.url) signedUrl(response.url, hosts);
  const bytes = await boundedBytes(response, receipt.bytes);
  if (bytes.length !== receipt.bytes) throw unsafe();
  const mimeType = imageType(bytes), sha256 = await hash(bytes);
  if (sha256 !== receipt.sha256) throw unsafe();
  const [width, height] = rasterDimensions(bytes, mimeType);
  if (width !== receipt.width || height !== receipt.height) throw unsafe();
  return { mimeType, data: base64(bytes), sha256 };
}

// Called only after imageType has validated the entire PNG/JPEG container.
// Read dimensions before handing compressed raster data to the MCP client.
function rasterDimensions(
  bytes: Uint8Array,
  type: EvidenceImage["mimeType"],
): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "image/png") return [view.getUint32(16), view.getUint32(20)];
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset++] !== 0xff) throw unsafe();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
    }
    if (marker === 0xda || marker === 0xd9) throw unsafe();
    offset += view.getUint16(offset);
  }
  throw unsafe();
}

/** Optional private media: missing trusted derivative hashes means text-only. */
export function createEvidenceMediaReader(
  input: MediaInput,
): EvidenceMediaReader {
  const hosts = new Set(input.allowedHosts.map((host) => host.toLowerCase())),
    fetcher = input.fetcher ?? fetch;
  return {
    async read(context, key) {
      if (!context.allow_images) return [];
      if (!context.scopes.includes("evidence:read")) {
        throw new ConnectorError(
          "insufficient_scope",
          403,
        );
      }
      const row = await input.store.execute({
        op: "read_evidence",
        input: {
          grant_id: context.grant_id,
          survey_id: key.survey_id,
          job_id: key.job_id,
          result_revision: key.result_revision,
        },
      });
      if (
        row.revision.survey_id !== key.survey_id ||
        row.revision.job_id !== key.job_id ||
        row.revision.revision !== key.result_revision
      ) throw unsafe();
      const manifest = record(row.revision.manifest),
        assets = manifest.assets,
        artifacts = record(manifest.artifacts),
        selected: { path: string; sha256: string }[] = [],
        seen = new Set<string>();
      for (const raw of Array.isArray(assets) ? assets : []) {
        const asset = record(raw);
        if (asset.kind !== "image") continue;
        const paths = record(asset.review_paths),
          hashes = record(asset.review_sha256);
        for (const variant of ["combined", "original"]) {
          const path = paths[variant];
          if (typeof path !== "string" || seen.has(path)) continue;
          if (
            !path || path.length > 2048 || /[:\\\x00-\x1f\x7f?#]/.test(path) ||
            path.startsWith("/") || path.split("/").includes("..")
          ) throw unsafe();
          // Pinned Kaggle results store verified receipts by exact private path,
          // not per-asset review_sha256. Keep the older contract compatible,
          // but never ignore a conflicting or malformed authoritative receipt.
          let expected = hashes[variant];
          if (Object.hasOwn(artifacts, path)) {
            const receipt = record(artifacts[path]);
            if (
              typeof receipt.sha256 !== "string" ||
              !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
              !Number.isSafeInteger(receipt.bytes) ||
              Number(receipt.bytes) < 1 ||
              (expected !== undefined && expected !== receipt.sha256)
            ) throw unsafe();
            expected = receipt.sha256;
          }
          if (
            typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)
          ) {
            continue;
          }
          selected.push({ path, sha256: expected });
          seen.add(path);
          break;
        }
        if (selected.length === LIMITS.imageCount) break;
      }
      if (!selected.length) return [];
      if (
        row.job.id !== row.revision.job_id ||
        typeof row.job.run_id !== "string" || !row.job.run_id ||
        row.job.run_id.length > 128
      ) throw unsafe();
      const links = await input.sign({
        action: "signed-pinned-review",
        job_id: String(row.job.id),
        run_id: row.job.run_id,
        paths: selected.map((image) => image.path),
      });
      const images: EvidenceImage[] = [];
      let total = 0;
      for (const image of selected) {
        const url = signedUrl(links[image.path], hosts);
        const response = await fetcher(url, {
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
          cache: "no-store",
        });
        if (response.url) signedUrl(response.url, hosts);
        const bytes = await boundedBytes(
          response,
          Math.min(
            LIMITS.imageBytes,
            LIMITS.imageBytes * LIMITS.imageCount - total,
          ),
        );
        const mimeType = imageType(bytes), sha256 = await hash(bytes);
        if (sha256 !== image.sha256) throw unsafe();
        total += bytes.length;
        images.push({ mimeType, data: base64(bytes), sha256 });
      }
      return images;
    },
  };
}
