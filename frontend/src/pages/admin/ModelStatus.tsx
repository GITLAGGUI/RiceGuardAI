import {
  Activity,
  Bot,
  CheckCircle2,
  Cloud,
  Cpu,
  Layers3,
  TriangleAlert,
} from "lucide-react";

const PIPELINE_STATUS = [
  "4K full-frame context pass",
  "1280 × 1280 tiles with 25% overlap",
  "Native-coordinate mask stitching",
  "Class-aware duplicate merging",
  "CVAT polygon and API result export",
];

export function ModelStatus() {
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-stone-500">AI system</div>
        <h1 className="font-display text-3xl font-bold md:text-4xl">Model readiness</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-500">
          Transparent status of the archived AWS baseline and the next 4K inference pipeline.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-stone-200 bg-white p-6">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-rice-100 text-rice-800">
              <Bot size={24} />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-stone-500">Archived segmentation baseline</div>
              <div className="mt-1 font-display text-xl font-bold">AWS L40S checkpoint</div>
              <div className="mt-1 text-sm text-stone-500">BLB + Rice Blast · instance segmentation</div>
            </div>
            <span className="ml-auto rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">Verified</span>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <Metric label="Mask mAP@50" value="44.8%" />
            <Metric label="Mask mAP@50–95" value="19.7%" />
            <Metric label="Mask precision" value="49.3%" />
            <Metric label="Mask recall" value="51.4%" />
          </div>
        </section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-amber-200 text-amber-950">
              <TriangleAlert size={23} />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-amber-800">Production model</div>
              <div className="mt-1 font-display text-xl font-bold text-amber-950">Waiting for approved data</div>
              <p className="mt-2 text-sm leading-relaxed text-amber-900">
                Paid retraining is gated until Video3 labels are complete and Video4 has sealed ground truth.
                Visible but unlabeled lesions must not be learned as background.
              </p>
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-6">
        <div className="flex items-center gap-3">
          <Layers3 size={19} />
          <h2 className="font-display text-xl font-bold">4K inference pipeline</h2>
          <span className="ml-auto rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800">Software ready</span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PIPELINE_STATUS.map((item) => (
            <div key={item} className="flex gap-2 rounded-xl bg-stone-50 p-3 text-sm text-stone-700">
              <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={17} />
              {item}
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <StatusCard icon={Cpu} title="Candidate models" copy="YOLO26m-Seg, YOLO26 semantic and RF-DETR-Seg-2XL" />
        <StatusCard icon={Cloud} title="Cloud contract" copy="S3 upload, queued GPU inference and native polygon result" />
        <StatusCard icon={Activity} title="Promotion rule" copy="Release only after stitched 4K holdout gates are met" />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-100 p-3">
      <div className="font-display text-2xl font-bold text-forest-950">{value}</div>
      <div className="mt-1 text-xs text-stone-500">{label}</div>
    </div>
  );
}

function StatusCard({ icon: Icon, title, copy }: { icon: typeof Cpu; title: string; copy: string }) {
  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-5">
      <Icon className="text-forest-800" size={20} />
      <div className="mt-4 font-semibold">{title}</div>
      <p className="mt-2 text-sm leading-relaxed text-stone-500">{copy}</p>
    </article>
  );
}
