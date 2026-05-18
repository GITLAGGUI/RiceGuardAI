import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Wheat, Bell, MapPin, ArrowRight, Sun, CloudRain } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { listMyAdvisories } from "@/services/advisories";
import { DISEASE_LABEL, SEVERITY_LABEL } from "@/types/domain";
import { formatDistanceToNow } from "date-fns";

export function FarmerHome() {
  const { profile } = useAuth();
  const { data: advisories = [], isLoading } = useQuery({
    queryKey: ["my-advisories", profile?.id],
    queryFn: () => listMyAdvisories(profile!.id),
    enabled: !!profile?.id,
  });

  const recent = advisories.slice(0, 3);
  const hasHigh = advisories.some((a) => a.severity === "high" && a.state === "sent");

  return (
    <div className="space-y-6">
      <div>
        <div className="text-stone-500 text-sm">Iyong dashboard</div>
        <h1 className="font-display text-3xl md:text-4xl font-bold">
          Aking Bukid
        </h1>
      </div>

      {/* Risk banner */}
      <div
        className={`rounded-2xl p-6 ${
          hasHigh
            ? "bg-red-50 border border-red-200"
            : "bg-rice-50 border border-rice-200"
        }`}
      >
        <div className="flex items-start gap-4">
          <div
            className={`w-12 h-12 rounded-xl grid place-items-center ${
              hasHigh ? "bg-red-500 text-white" : "bg-rice-500 text-white"
            }`}
          >
            <Wheat size={24} />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold uppercase tracking-wider text-stone-500">
              Kalagayan ng bukid ngayon
            </div>
            <div className="font-display text-2xl md:text-3xl font-bold mt-1">
              {hasHigh ? "May matataas na alerto" : "Malinaw — walang kritikal"}
            </div>
            <p className="text-stone-600 mt-2 text-sm">
              {profile?.barangay
                ? `Para sa ${profile.barangay}, ${profile.municipality}`
                : "Tingnan ang mga alerto sa ibaba."}
            </p>
          </div>
        </div>
      </div>

      {/* Weather card placeholder — will wire to /weather edge fn in Phase 4 */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Panahon ngayon
            </div>
            <div className="font-display text-2xl font-bold mt-1">29°C · Maaraw</div>
            <div className="text-sm text-stone-500 mt-1">
              Magandang oras mag-spray ngayong umaga.
            </div>
          </div>
          <div className="text-rice-500">
            <Sun size={56} strokeWidth={1.5} />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <Mini icon={<Sun size={16} />} label="Humid" value="78%" />
          <Mini icon={<CloudRain size={16} />} label="Ulan (4hr)" value="20%" />
          <Mini icon={<Wheat size={16} />} label="Blast risk" value="Mid" />
        </div>
      </div>

      {/* Recent alerts */}
      <div className="bg-white rounded-2xl border border-stone-200">
        <div className="px-6 py-4 flex items-center justify-between border-b border-stone-100">
          <div className="flex items-center gap-2 font-semibold">
            <Bell size={18} />
            Mga huling alerto
          </div>
          <Link to="/farmer/alerts" className="text-sm text-forest-800 hover:underline">
            Lahat
          </Link>
        </div>
        <div className="divide-y divide-stone-100">
          {isLoading && (
            <div className="px-6 py-8 text-center text-stone-400 text-sm">
              Naglo-load…
            </div>
          )}
          {!isLoading && recent.length === 0 && (
            <div className="px-6 py-12 text-center">
              <Wheat size={40} className="mx-auto text-stone-300" />
              <div className="text-stone-500 text-sm mt-3">Wala pang alerto. Mabuti!</div>
            </div>
          )}
          {recent.map((a) => (
            <div key={a.id} className="px-6 py-4 flex items-center gap-4">
              <div
                className="w-2 h-12 rounded-full"
                style={{ background: SEVERITY_LABEL[a.severity].color }}
              />
              <div className="flex-1">
                <div className="font-semibold">{DISEASE_LABEL[a.disease].tl}</div>
                <div className="text-sm text-stone-500">
                  {SEVERITY_LABEL[a.severity].tl} ·{" "}
                  {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                </div>
              </div>
              <ArrowRight size={18} className="text-stone-300" />
            </div>
          ))}
        </div>
      </div>

      <Link
        to="/farmer/map"
        className="block bg-forest-950 hover:bg-forest-900 text-white rounded-2xl p-6 transition"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-rice-400 grid place-items-center text-forest-950">
            <MapPin size={22} />
          </div>
          <div className="flex-1">
            <div className="font-display text-lg font-bold">Tingnan ang Mapa ng Bukid</div>
            <div className="text-rice-200/80 text-sm">
              Eksaktong lokasyon ng mga sakit
            </div>
          </div>
          <ArrowRight />
        </div>
      </Link>
    </div>
  );
}

function Mini({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-stone-100 p-3">
      <div className="flex items-center gap-1.5 text-xs text-stone-500">
        {icon}
        {label}
      </div>
      <div className="font-semibold mt-1">{value}</div>
    </div>
  );
}
