import { z } from "zod";
import type { EvidenceImage, GrantContext, RevisionKey } from "./contracts.ts";
import type { MediaInput } from "./media.ts";
import { readVerifiedImage } from "./media.ts";
import { ConnectorError } from "./policy.ts";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const entrySchema = z.object({
  source_asset_id: z.uuid(),
  image_index: z.number().int().min(1).max(10),
  variant: z.enum(["original", "combined"]),
  source_sha256: sha,
  path: z.string().max(2048),
  sha256: sha,
  bytes: z.number().int().min(1).max(768 * 1024),
  width: z.number().int().min(1).max(2048),
  height: z.number().int().min(1).max(2048),
  quality: z.number().int().min(50).max(85),
}).strict();
export const catalogueSchema = z.object({
  schema_version: z.literal("riceguard.advisory.catalogue.v1"),
  policy_version: z.literal("visual-v1"),
  survey_id: z.uuid(),
  job_id: z.uuid(),
  result_revision: z.number().int().positive(),
  entries: z.array(entrySchema).min(2).max(20),
}).strict();
type Entry = z.infer<typeof entrySchema>;
export type VisualImageMetadata =
  & Pick<
    Entry,
    | "source_asset_id"
    | "image_index"
    | "variant"
    | "sha256"
    | "width"
    | "height"
  >
  & { image_id: string };
export type VisualCatalogue = {
  catalogue_sha256: string;
  expected_images: number;
  images: VisualImageMetadata[];
};
export type VisualKey = RevisionKey & { catalogue_sha256: string };
export type VisualPage = {
  catalogue_sha256: string;
  expected_images: number;
  offset: number;
  next_offset: number | null;
  images: (VisualImageMetadata & EvidenceImage)[];
};
export interface VisualMediaReader {
  catalogue(context: GrantContext, key: RevisionKey): Promise<VisualCatalogue>;
  read(
    context: GrantContext,
    key: VisualKey & { offset: number },
  ): Promise<VisualPage>;
  assertDelivered(context: GrantContext, key: VisualKey): Promise<void>;
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
const unavailable = () =>
  new ConnectorError(
    "visual_media_not_ready",
    409,
    "Complete, verified original and overlay images are required for visual advice",
  );
const metadata = (e: Entry): VisualImageMetadata => ({
  image_id: `${e.source_asset_id}:${e.variant}`,
  source_asset_id: e.source_asset_id,
  image_index: e.image_index,
  variant: e.variant,
  sha256: e.sha256,
  width: e.width,
  height: e.height,
});
export function createVisualMediaReader(input: MediaInput): VisualMediaReader {
  async function load(context: GrantContext, key: RevisionKey) {
    if (!context.allow_images || !context.scopes.includes("evidence:read")) {
      throw new ConnectorError("insufficient_scope", 403);
    }
    const target = {
      survey_id: key.survey_id,
      job_id: key.job_id,
      result_revision: key.result_revision,
    };
    const saved = await input.store.execute({
      op: "read_visual_catalogue",
      input: { grant_id: context.grant_id, ...target },
    });
    const parsed = catalogueSchema.safeParse(saved.catalogue);
    if (
      !parsed.success || typeof saved.catalogue_sha256 !== "string" ||
      !sha.safeParse(saved.catalogue_sha256).success
    ) throw unavailable();
    const c = parsed.data;
    if (
      c.survey_id !== key.survey_id || c.job_id !== key.job_id ||
      c.result_revision !== key.result_revision
    ) throw unavailable();
    const row = await input.store.execute({
      op: "read_evidence",
      input: { grant_id: context.grant_id, ...target },
    });
    if (
      row.revision.survey_id !== key.survey_id ||
      row.revision.job_id !== key.job_id ||
      row.revision.revision !== key.result_revision ||
      row.job.id !== key.job_id || typeof row.job.run_id !== "string" ||
      !/^rg-[a-z0-9-]{8,80}$/.test(row.job.run_id)
    ) throw unavailable();
    const m = record(row.revision.manifest), receipts = record(m.artifacts);
    const assets = (Array.isArray(m.assets) ? m.assets : []).map(record).filter(
      (a) => a.kind === "image",
    );
    if (
      assets.length < 1 || assets.length > 10 ||
      c.entries.length !== assets.length * 2
    ) throw unavailable();
    const ordered: Entry[] = [];
    for (const [i, asset] of assets.entries()) {
      const paths = record(asset.review_paths);
      for (const variant of ["original", "combined"] as const) {
        const matches = c.entries.filter((e) =>
          e.source_asset_id === asset.source_asset_id && e.variant === variant
        );
        if (matches.length !== 1) throw unavailable();
        const e = matches[0], sourcePath = paths[variant];
        const receipt = typeof sourcePath === "string"
          ? record(receipts[sourcePath])
          : {};
        const expectedPath =
          `website-inference/v2/jobs/${row.job.run_id}/outputs/advisory-media/visual-v1/${e.source_asset_id}/${variant}.jpg`;
        if (
          e.image_index !== i + 1 || e.path !== expectedPath ||
          e.source_sha256 !== receipt.sha256 ||
          !sha.safeParse(receipt.sha256).success
        ) throw unavailable();
        ordered.push(e);
      }
    }
    if (new Set(ordered.map((e) => e.path)).size !== ordered.length) {
      throw unavailable();
    }
    return {
      entries: ordered,
      digest: saved.catalogue_sha256,
      target,
      run: row.job.run_id,
    };
  }
  function match(expected: string, actual: string) {
    if (expected !== actual) {
      throw new ConnectorError(
        "stale_visual_catalogue",
        409,
        "Read the current visual catalogue before continuing",
      );
    }
  }
  return {
    async catalogue(context, key) {
      const c = await load(context, key);
      return {
        catalogue_sha256: c.digest,
        expected_images: c.entries.length,
        images: c.entries.map(metadata),
      };
    },
    async read(context, key) {
      if (
        !Number.isSafeInteger(key.offset) || key.offset < 0 || key.offset % 2
      ) throw new ConnectorError("invalid_image_offset", 400);
      const c = await load(context, key);
      match(key.catalogue_sha256, c.digest);
      if (key.offset >= c.entries.length) {
        throw new ConnectorError("invalid_image_offset", 400);
      }
      const selected = c.entries.slice(key.offset, key.offset + 2);
      const links = await input.sign({
        action: "signed-pinned-review",
        job_id: key.job_id,
        run_id: c.run,
        paths: selected.map((e) => e.path),
      });
      const images: VisualPage["images"] = [];
      for (const e of selected) {
        images.push({
          ...metadata(e),
          ...await readVerifiedImage(links[e.path], e, input),
        });
      }
      // Rechecks grant and current revision inside SQL. A partial transfer never
      // records a complete pair and a revocation during download denies return.
      const receipt = await input.store.execute({
        op: "record_visual_delivery",
        input: {
          grant_id: context.grant_id,
          ...c.target,
          catalogue_sha256: c.digest,
          image_ids: images.map((e) => e.image_id),
        },
      });
      if (receipt.recorded !== true) throw unavailable();
      return {
        catalogue_sha256: c.digest,
        expected_images: c.entries.length,
        offset: key.offset,
        next_offset: key.offset + 2 < c.entries.length ? key.offset + 2 : null,
        images,
      };
    },
    async assertDelivered(context, key) {
      const c = await load(context, key);
      match(key.catalogue_sha256, c.digest);
      const receipt = await input.store.execute({
        op: "assert_visual_delivery",
        input: {
          grant_id: context.grant_id,
          ...c.target,
          catalogue_sha256: c.digest,
        },
      });
      if (receipt.complete !== true) throw unavailable();
    },
  };
}
