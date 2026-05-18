import { Activity, Bot } from "lucide-react";

export function ModelStatus() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">
          AI Model
        </div>
        <h1 className="font-display text-3xl md:text-4xl font-bold">Model status</h1>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-rice-100 grid place-items-center text-rice-800">
            <Bot size={24} />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">
              Active advisory model
            </div>
            <div className="font-display text-xl font-bold mt-1">gemma4:31b-cloud</div>
            <div className="text-sm text-stone-500">Ollama Cloud · field + SMS modes</div>
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Online
          </span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 p-6">
        <div className="flex items-center gap-3">
          <Activity size={18} />
          <div className="font-semibold">Detection model</div>
        </div>
        <p className="text-stone-500 mt-3 text-sm leading-relaxed">
          YOLO detection model is not yet integrated. Detections are currently marked manually
          by admins via the scan upload UI. Once a trained YOLO model is available, wire it
          to an <code className="px-1 py-0.5 rounded bg-stone-100 text-xs">infer-scan</code>{" "}
          Edge function and add a "Run AI inference" button to the scan uploader.
        </p>
      </div>
    </div>
  );
}
