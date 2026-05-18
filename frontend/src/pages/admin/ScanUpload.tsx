import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, Trash2, Save, MapPin, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { LeafletMap } from "@/components/map/LeafletMap";
import type { Disease, Severity, DiseaseDetection } from "@/types/database";
import { DISEASE_LABEL, SEVERITY_LABEL } from "@/types/domain";
import {
  createScanWithDetections,
  findNearbyFarmers,
  generateAdvisory,
  type DraftDetection,
} from "@/services/scans";

interface PinDraft extends DraftDetection {
  id: string; // local temp id only
  confidence_score: number;
  location_text: string;
}

const ISABELA_CENTER: [number, number] = [17.1485, 121.8107];

export function ScanUpload() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [scanName, setScanName] = useState("");
  const [capturedAt, setCapturedAt] = useState(() =>
    new Date().toISOString().slice(0, 16)
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<PinDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [autoAdvisories, setAutoAdvisories] = useState(true);

  const [stage, setStage] = useState<"compose" | "advisories">("compose");
  const [generatedSummary, setGeneratedSummary] = useState<{
    saved: number;
    advisories: number;
    skipped: number;
    scan_id?: string;
  } | null>(null);

  const handleImage = (file: File) => {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const addPin = (lat: number, lng: number) => {
    setDrafts((d) => [
      ...d,
      {
        id: crypto.randomUUID(),
        disease: "rice_blast",
        severity: "medium",
        lat,
        lng,
        confidence_score: 0.85,
        location_text: "",
      },
    ]);
    toast.info("Pin added — set disease + severity on the right");
  };

  const updateDraft = (id: string, patch: Partial<PinDraft>) =>
    setDrafts((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const removeDraft = (id: string) => setDrafts((d) => d.filter((x) => x.id !== id));

  const fakeDetections: DiseaseDetection[] = useMemo(
    () =>
      drafts.map((d) => ({
        id: d.id,
        scan_id: "",
        farmer_id: null,
        disease: d.disease,
        severity: d.severity,
        lat: d.lat,
        lng: d.lng,
        location_text: d.location_text,
        confidence_score: d.confidence_score,
        affected_area_pct: null,
        bbox_json: null,
        image_url: null,
        created_at: new Date().toISOString(),
      })),
    [drafts]
  );

  const handleSave = async () => {
    if (!profile) return;
    if (!scanName.trim()) return toast.error("Add a scan name");
    if (drafts.length === 0) return toast.error("Add at least one detection pin");

    setBusy(true);
    try {
      // 1. Optional storage upload
      let storedPath: string | null = null;
      if (imageFile) {
        const ext = imageFile.name.split(".").pop() ?? "jpg";
        const path = `${profile.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("scans")
          .upload(path, imageFile, { upsert: false });
        if (upErr) throw upErr;
        storedPath = path;
      }

      // 2. Create scan + detections atomically via RPC
      const { scan_id, detection_ids } = await createScanWithDetections(
        {
          scan_name: scanName.trim(),
          source_type: "manual",
          stored_path: storedPath,
          captured_at: new Date(capturedAt).toISOString(),
        },
        drafts.map((d) => ({
          disease: d.disease,
          severity: d.severity,
          lat: d.lat,
          lng: d.lng,
          location_text: d.location_text || undefined,
          confidence_score: d.confidence_score,
        }))
      );

      toast.success(`Scan saved with ${drafts.length} detection${drafts.length === 1 ? "" : "s"}`);

      // 3. Optional: auto-generate advisories for medium+/high detections
      let advisoriesCreated = 0;
      let skipped = 0;

      if (autoAdvisories) {
        toast.loading("Looking for nearby farmers + drafting Tagalog advisories…", {
          id: "auto-adv",
        });

        for (let i = 0; i < drafts.length; i++) {
          const d = drafts[i];
          const id = detection_ids[i];
          if (!id) continue;
          if (d.severity === "low") {
            skipped++;
            continue;
          }

          const nearby = await findNearbyFarmers(d.lat, d.lng, 15).catch(() => []);
          if (nearby.length === 0) {
            skipped++;
            continue;
          }

          // For demo: pick the nearest. In production admin would multi-select.
          const target = nearby[0];
          try {
            await generateAdvisory(id, target.id);
            advisoriesCreated++;
          } catch (e) {
            console.warn("[generate-advisory] failed", e);
            skipped++;
          }
        }

        toast.dismiss("auto-adv");
        if (advisoriesCreated > 0) {
          toast.success(
            `Drafted ${advisoriesCreated} advisory${advisoriesCreated === 1 ? "" : "s"}. Review at Advisories →`
          );
        }
      }

      setGeneratedSummary({
        saved: drafts.length,
        advisories: advisoriesCreated,
        skipped,
        scan_id,
      });
      setStage("advisories");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  if (stage === "advisories" && generatedSummary) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="bg-white rounded-3xl border border-stone-200 p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-rice-100 grid place-items-center text-rice-800 mx-auto">
            <Sparkles size={28} />
          </div>
          <h1 className="font-display text-3xl font-bold mt-5">Saved.</h1>
          <p className="text-stone-500 mt-2">
            {generatedSummary.saved} detection
            {generatedSummary.saved === 1 ? "" : "s"} committed.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Stat label="Advisories drafted" value={generatedSummary.advisories} />
            <Stat label="Skipped (no farmer or low)" value={generatedSummary.skipped} />
          </div>

          <div className="mt-8 flex flex-col gap-2">
            <button
              onClick={() => navigate("/admin/advisories")}
              className="w-full tap rounded-xl bg-forest-900 hover:bg-forest-950 text-white font-semibold py-3"
            >
              Review advisories
            </button>
            <button
              onClick={() => navigate("/admin/scans")}
              className="w-full tap rounded-xl border border-stone-300 hover:bg-stone-50 py-3"
            >
              Back to scans
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">
          New Drone Scan
        </div>
        <h1 className="font-display text-3xl md:text-4xl font-bold">
          Upload + mark detections
        </h1>
        <p className="text-stone-500 mt-1">
          Upload a drone image, click on the map for each affected area, then save.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-stone-700">Scan name</span>
            <input
              type="text"
              value={scanName}
              onChange={(e) => setScanName(e.target.value)}
              placeholder="2026-05-17 Ilagan north field"
              className="w-full mt-1.5 px-4 py-2.5 rounded-xl border border-stone-300 focus:border-forest-600 outline-none"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-stone-700">Captured at</span>
            <input
              type="datetime-local"
              value={capturedAt}
              onChange={(e) => setCapturedAt(e.target.value)}
              className="w-full mt-1.5 px-4 py-2.5 rounded-xl border border-stone-300 focus:border-forest-600 outline-none"
            />
          </label>
        </div>

        <div>
          <span className="text-sm font-medium text-stone-700">Drone image (optional)</span>
          <label className="mt-1.5 flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-stone-300 cursor-pointer hover:border-forest-300 transition">
            <Upload size={18} className="text-stone-500" />
            <span className="text-sm text-stone-500">
              {imageFile ? imageFile.name : "Click to upload JPG / PNG / WEBP"}
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImage(f);
              }}
            />
            {imageFile && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setImageFile(null);
                  setImagePreview(null);
                }}
                className="ml-auto text-stone-400 hover:text-red-500"
                aria-label="Remove image"
              >
                <X size={16} />
              </button>
            )}
          </label>
        </div>

        <label className="flex items-center gap-3 pt-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoAdvisories}
            onChange={(e) => setAutoAdvisories(e.target.checked)}
            className="w-4 h-4 accent-forest-700"
          />
          <span className="text-sm">
            Auto-generate Tagalog advisories for nearby farmers (medium + high severity)
          </span>
        </label>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
        <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-stone-100 flex items-center gap-2 text-sm">
            <MapPin size={16} /> Click on the map to add a detection pin
          </div>
          <LeafletMap
            center={ISABELA_CENTER}
            zoom={13}
            detections={fakeDetections}
            onMapClick={addPin}
            height="500px"
          />
        </div>

        <div className="bg-white rounded-2xl border border-stone-200 flex flex-col">
          {imagePreview && (
            <div className="p-3 border-b border-stone-100">
              <img
                src={imagePreview}
                alt="Drone preview"
                className="rounded-lg w-full aspect-video object-cover"
                loading="lazy"
              />
            </div>
          )}
          <div className="px-5 py-3 border-b border-stone-100 font-medium">
            Pinned detections ({drafts.length})
          </div>
          <div className="flex-1 overflow-auto divide-y divide-stone-100 max-h-[440px]">
            {drafts.length === 0 && (
              <div className="p-8 text-center text-stone-400 text-sm">
                Walang pin pa. Click on the map.
              </div>
            )}
            {drafts.map((d, i) => (
              <div key={d.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ background: SEVERITY_LABEL[d.severity].color }}
                    />
                    <div className="text-sm font-semibold">Detection #{i + 1}</div>
                    <div className="text-xs text-stone-400 font-mono">
                      {d.lat.toFixed(4)}, {d.lng.toFixed(4)}
                    </div>
                  </div>
                  <button
                    onClick={() => removeDraft(d.id)}
                    className="text-stone-400 hover:text-red-500"
                    aria-label="Remove"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={d.disease}
                    onChange={(e) =>
                      updateDraft(d.id, { disease: e.target.value as Disease })
                    }
                    className="px-3 py-2 rounded-lg border border-stone-300 text-sm focus:border-forest-600 outline-none"
                  >
                    {(Object.keys(DISEASE_LABEL) as Disease[]).map((k) => (
                      <option key={k} value={k}>
                        {DISEASE_LABEL[k].en}
                      </option>
                    ))}
                  </select>
                  <select
                    value={d.severity}
                    onChange={(e) =>
                      updateDraft(d.id, { severity: e.target.value as Severity })
                    }
                    className="px-3 py-2 rounded-lg border border-stone-300 text-sm focus:border-forest-600 outline-none"
                  >
                    {(["low", "medium", "high"] as Severity[]).map((k) => (
                      <option key={k} value={k}>
                        {SEVERITY_LABEL[k].en}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  value={d.location_text}
                  onChange={(e) => updateDraft(d.id, { location_text: e.target.value })}
                  placeholder="Location note (optional)"
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm focus:border-forest-600 outline-none"
                />
                <div>
                  <label className="text-xs text-stone-500">
                    Confidence: {Math.round(d.confidence_score * 100)}%
                  </label>
                  <input
                    type="range"
                    min={0.5}
                    max={1}
                    step={0.01}
                    value={d.confidence_score}
                    onChange={(e) =>
                      updateDraft(d.id, { confidence_score: Number(e.target.value) })
                    }
                    className="w-full accent-forest-700"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 border-t border-stone-100">
            <button
              onClick={handleSave}
              disabled={busy || drafts.length === 0 || !scanName.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-forest-900 hover:bg-forest-950 text-white font-semibold py-3 transition disabled:opacity-50"
            >
              <Save size={18} />
              {busy
                ? "Saving…"
                : `Save scan + ${drafts.length} detection${drafts.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-stone-100 p-4 text-center">
      <div className="font-display text-3xl font-bold">{value}</div>
      <div className="text-xs text-stone-500 mt-1">{label}</div>
    </div>
  );
}
