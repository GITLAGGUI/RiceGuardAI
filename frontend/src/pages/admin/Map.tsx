import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAllDetections } from "@/services/detections";
import { LeafletMap } from "@/components/map/LeafletMap";
import { DISEASE_LABEL, SEVERITY_LABEL } from "@/types/domain";
import type { Disease, Severity } from "@/types/database";

const ISABELA_CENTER: [number, number] = [17.1485, 121.8107];

export function AdminMap() {
  const [diseaseFilter, setDiseaseFilter] = useState<Disease | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");

  const { data: detections = [], isLoading } = useQuery({
    queryKey: ["all-detections"],
    queryFn: () => listAllDetections(),
  });

  const filtered = detections.filter(
    (d) =>
      (diseaseFilter === "all" || d.disease === diseaseFilter) &&
      (severityFilter === "all" || d.severity === severityFilter)
  );

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">
            Field Map
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold">All detections</h1>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <select
            value={diseaseFilter}
            onChange={(e) => setDiseaseFilter(e.target.value as Disease | "all")}
            className="flex-1 sm:flex-none px-3 py-2 rounded-lg border border-stone-300 text-sm focus:border-forest-600 outline-none"
          >
            <option value="all">All diseases</option>
            {(Object.keys(DISEASE_LABEL) as Disease[]).map((k) => (
              <option key={k} value={k}>
                {DISEASE_LABEL[k].en}
              </option>
            ))}
          </select>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as Severity | "all")}
            className="flex-1 sm:flex-none px-3 py-2 rounded-lg border border-stone-300 text-sm focus:border-forest-600 outline-none"
          >
            <option value="all">All severity</option>
            {(["low", "medium", "high"] as Severity[]).map((k) => (
              <option key={k} value={k}>
                {SEVERITY_LABEL[k].en}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
        <LeafletMap
          center={ISABELA_CENTER}
          zoom={10}
          detections={filtered}
          height="70vh"
        />
      </div>

      <div className="text-sm text-stone-500">
        {isLoading
          ? "Loading…"
          : `${filtered.length} of ${detections.length} detection${
              detections.length === 1 ? "" : "s"
            } shown.`}
      </div>
    </div>
  );
}
