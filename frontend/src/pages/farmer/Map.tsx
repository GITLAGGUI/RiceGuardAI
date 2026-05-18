import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { LeafletMap } from "@/components/map/LeafletMap";
import { listDetections } from "@/services/detections";
import { SEVERITY_LABEL } from "@/types/domain";

const ISABELA_CENTER: [number, number] = [17.1485, 121.8107];

export function FarmerMap() {
  const { profile } = useAuth();
  const { data: detections = [], isLoading } = useQuery({
    queryKey: ["my-detections", profile?.id],
    queryFn: () => listDetections({ farmerId: profile!.id }),
    enabled: !!profile?.id,
  });

  return (
    <div className="space-y-5">
      <div>
        <div className="text-stone-500 text-sm">Mapa ng Bukid</div>
        <h1 className="font-display text-3xl md:text-4xl font-bold">
          Saang lugar ang sakit?
        </h1>
        <p className="text-stone-500 mt-1">
          Kulay-coded ng severity: berde = mababa, dilaw = katamtaman, pula = mataas.
        </p>
      </div>

      <div className="rounded-2xl overflow-hidden border border-stone-200">
        <LeafletMap
          center={ISABELA_CENTER}
          zoom={11}
          detections={detections}
          height="60vh"
        />
      </div>

      <div className="flex gap-3 flex-wrap">
        {(["low", "medium", "high"] as const).map((s) => (
          <div
            key={s}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-stone-200 text-sm"
          >
            <span
              className="w-3 h-3 rounded-full"
              style={{ background: SEVERITY_LABEL[s].color }}
            />
            {SEVERITY_LABEL[s].tl}
          </div>
        ))}
      </div>

      <div className="text-sm text-stone-500">
        {isLoading
          ? "Naglo-load…"
          : detections.length === 0
            ? "Wala pang detection sa iyong bukid."
            : `${detections.length} detection${detections.length === 1 ? "" : "s"} ang nakita.`}
      </div>
    </div>
  );
}
