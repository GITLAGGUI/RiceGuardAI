import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Cloud,
  Database,
  FileCheck2,
  Gauge,
  Layers3,
  ScanSearch,
  ShieldCheck,
  TriangleAlert,
  UploadCloud,
} from "lucide-react";

const METRICS = [
  { value: "44.8%", label: "Mask mAP@50", note: "Combined validation" },
  { value: "19.7%", label: "Mask mAP@50–95", note: "Combined validation" },
  { value: "49.3%", label: "Mask precision", note: "Combined validation" },
  { value: "51.4%", label: "Mask recall", note: "Combined validation" },
];

const PIPELINE = [
  {
    icon: UploadCloud,
    number: "01",
    title: "Upload the original 4K frame",
    copy: "The 3840×2160 RGB image stays intact and is uploaded directly to secure cloud storage.",
  },
  {
    icon: Layers3,
    number: "02",
    title: "Context pass + overlapping tiles",
    copy: "A full-frame pass preserves scene context while 1280×1280 tiles retain pixels for small lesions.",
  },
  {
    icon: ScanSearch,
    number: "03",
    title: "Segment BLB and Rice Blast",
    copy: "Masks are predicted per tile, mapped back to native coordinates, then duplicates are merged.",
  },
  {
    icon: Cloud,
    number: "04",
    title: "Return a reviewable result",
    copy: "The API returns polygons, confidence, severity ratio and a preview; CVAT remains available for human review.",
  },
];

const READINESS = [
  "Canonical labels are BLB and Rice Blast only",
  "Healthy is an image outcome, not a polygon class",
  "4K context + exhaustive tiled inference is implemented",
  "Native-coordinate merging and CVAT polygon export are verified",
  "Async AWS API/S3/SQS/DynamoDB worker package is prepared",
  "Video4 is protected as a sealed flight-level holdout",
];

const BLOCKERS = [
  "Expert completeness and disease-identity review for Dataset_V3",
  "Complete polygons for 60 selected Video3 training keyframes",
  "Ground-truth annotations for 50 sealed Video4 holdout keyframes",
  "Approved 1280/768 tile datasets before paid model comparison",
];

const EVIDENCE = [
  {
    src: "/evidence/aws-training-curves.png",
    eyebrow: "AWS L40S · completed",
    title: "Training and validation curves",
    copy: "The selected standard recipe completed 85 final-stage epochs with MuSGD, batch 8 and early-stopping patience 20.",
  },
  {
    src: "/evidence/aws-confusion-matrix.png",
    eyebrow: "Validation evidence",
    title: "Raw confusion matrix",
    copy: "The matrix exposes the remaining class/background errors instead of hiding them behind one accuracy number.",
  },
  {
    src: "/evidence/aws-validation-predictions.jpg",
    eyebrow: "Model output",
    title: "Validation prediction sample",
    copy: "A representative batch from the archived AWS run, retained with the best checkpoint and metrics.",
  },
  {
    src: "/evidence/tiled-4k-smoke-preview.jpg",
    eyebrow: "Current pipeline · integration proof",
    title: "4K tiled inference preview",
    copy: "The current pipeline restored candidate masks to a 3840×2160 Video4 frame. This proves stitching—not accuracy—because expert ground truth is still pending.",
  },
];

export function SystemEvidence() {
  useEffect(() => {
    document.title = "RiceGuard AI — 4K system and evidence";
  }, []);

  return (
    <main className="min-h-screen bg-[#f5f5ef] text-stone-950">
      <header className="sticky top-0 z-50 border-b border-stone-200/80 bg-[#f5f5ef]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-10">
          <Link to="/" className="flex items-center gap-3 font-display text-lg font-bold">
            <img src="/images/mascot/field-companion.png" alt="" className="h-9 w-9 object-contain" />
            RiceGuard<span className="text-rice-600">.</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 sm:inline-flex">
              Research build · not diagnostic release
            </span>
            <Link
              to="/"
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-forest-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-forest-900"
            >
              <ArrowLeft size={16} /> Home
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-forest-950 text-white">
        <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_75%_25%,#97c057_0,transparent_36%),linear-gradient(120deg,transparent_25%,#064e3b_100%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 py-20 md:px-10 lg:grid-cols-[1.25fr_.75fr] lg:py-28">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-rice-200">
              <Gauge size={15} /> System truth page
            </div>
            <h1 className="max-w-4xl font-display text-5xl font-bold leading-[.96] tracking-[-.045em] sm:text-6xl lg:text-7xl">
              See the whole field. Keep the pixels that matter.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-stone-200">
              RiceGuard is being rebuilt for native 4K drone imagery: full-frame context for the field,
              overlapping high-resolution tiles for tiny lesions, and precise polygons for BLB and Rice Blast.
            </p>
            <div className="mt-9 flex flex-wrap gap-3 text-sm">
              <span className="rounded-full bg-rice-300 px-4 py-2 font-semibold text-forest-950">BLB</span>
              <span className="rounded-full bg-rice-300 px-4 py-2 font-semibold text-forest-950">Rice Blast</span>
              <span className="rounded-full border border-white/20 px-4 py-2 text-stone-200">Healthy = no final disease mask</span>
            </div>
          </div>

          <aside className="self-end rounded-[2rem] border border-white/15 bg-white/10 p-6 backdrop-blur md:p-8">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-rice-300 text-forest-950">
                <ShieldCheck size={23} />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[.16em] text-rice-200">Current decision</div>
                <div className="mt-1 font-display text-xl font-bold">Build ready, training gated</div>
              </div>
            </div>
            <p className="mt-5 text-sm leading-relaxed text-stone-200">
              The software pipeline is implemented. A new paid training run is intentionally waiting for complete,
              expert-approved labels so visible but unlabeled lesions are not learned as background.
            </p>
          </aside>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-16 md:px-10 md:py-24">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {METRICS.map((metric) => (
            <article key={metric.label} className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
              <div className="font-display text-4xl font-bold text-forest-950">{metric.value}</div>
              <div className="mt-3 font-semibold">{metric.label}</div>
              <div className="mt-1 text-xs text-stone-500">{metric.note}</div>
            </article>
          ))}
        </div>
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
          <TriangleAlert className="mt-0.5 shrink-0" size={18} />
          <p>
            These are archived AWS baseline metrics, not production claims. Field Rice Blast remained the main
            bottleneck: field recall was 12.5% and field mask mAP@50–95 was 0.6%, which is why the next iteration
            prioritizes complete labels, native-scale tiling and a sealed flight-level evaluation.
          </p>
        </div>
      </section>

      <section className="border-y border-stone-200 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 md:px-10 md:py-24">
          <div className="max-w-3xl">
            <div className="text-xs font-bold uppercase tracking-[.2em] text-rice-700">From drone to polygon</div>
            <h2 className="mt-4 font-display text-4xl font-bold tracking-[-.035em] md:text-5xl">
              The automated version of “look, zoom, trace.”
            </h2>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {PIPELINE.map((step) => (
              <article key={step.number} className="group rounded-3xl border border-stone-200 bg-[#f8f8f3] p-6">
                <div className="flex items-center justify-between">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-forest-950 text-rice-200">
                    <step.icon size={23} />
                  </div>
                  <div className="font-mono text-sm text-stone-400">{step.number}</div>
                </div>
                <h3 className="mt-8 font-display text-xl font-bold">{step.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-stone-600">{step.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:px-10 md:py-24 lg:grid-cols-2">
        <article className="rounded-[2rem] bg-forest-950 p-7 text-white md:p-9">
          <div className="flex items-center gap-3 text-rice-200">
            <FileCheck2 size={21} />
            <span className="text-xs font-bold uppercase tracking-[.18em]">Implemented</span>
          </div>
          <h2 className="mt-5 font-display text-3xl font-bold">What works now</h2>
          <ul className="mt-7 space-y-4">
            {READINESS.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-relaxed text-stone-200">
                <CheckCircle2 className="mt-0.5 shrink-0 text-rice-300" size={18} /> {item}
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-[2rem] border border-stone-200 bg-white p-7 md:p-9">
          <div className="flex items-center gap-3 text-amber-700">
            <Database size={21} />
            <span className="text-xs font-bold uppercase tracking-[.18em]">Scientific gate</span>
          </div>
          <h2 className="mt-5 font-display text-3xl font-bold">What still needs human evidence</h2>
          <ol className="mt-7 space-y-4">
            {BLOCKERS.map((item, index) => (
              <li key={item} className="flex gap-4 text-sm leading-relaxed text-stone-700">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-100 font-mono text-xs font-bold text-amber-900">
                  {index + 1}
                </span>
                {item}
              </li>
            ))}
          </ol>
          <div className="mt-8 rounded-2xl bg-stone-100 p-4 text-sm leading-relaxed text-stone-600">
            After approval, the controlled candidates are YOLO26m-Seg, YOLO26 semantic segmentation and
            RF-DETR-Seg-2XL. Promotion depends on stitched 4K holdout results—not paper scores.
          </div>
        </article>
      </section>

      <section className="bg-[#101c16] text-white">
        <div className="mx-auto max-w-7xl px-5 py-16 md:px-10 md:py-24">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <div className="text-xs font-bold uppercase tracking-[.2em] text-rice-300">Evidence archive</div>
              <h2 className="mt-4 max-w-3xl font-display text-4xl font-bold tracking-[-.035em] md:text-5xl">
                Results shown with their limitations.
              </h2>
            </div>
            <div className="max-w-sm text-sm leading-relaxed text-stone-300">
              Every image below comes from the stored training artifacts or the current 4K pipeline smoke test.
            </div>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            {EVIDENCE.map((item) => (
              <figure key={item.src} className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/5">
                <div className="aspect-[16/10] overflow-hidden bg-white">
                  <img src={item.src} alt={item.title} className="h-full w-full object-contain" loading="lazy" />
                </div>
                <figcaption className="p-6">
                  <div className="text-xs font-bold uppercase tracking-[.16em] text-rice-300">{item.eyebrow}</div>
                  <h3 className="mt-2 font-display text-2xl font-bold">{item.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-stone-300">{item.copy}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-forest-950 px-5 py-10 text-white md:px-10">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div>
            <div className="font-display text-xl font-bold">RiceGuard AI</div>
            <div className="mt-1 text-sm text-stone-400">Evidence-first rice disease monitoring research.</div>
          </div>
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-rice-200 hover:text-white">
            Explore the main site <ArrowRight size={16} />
          </Link>
        </div>
      </footer>
    </main>
  );
}
