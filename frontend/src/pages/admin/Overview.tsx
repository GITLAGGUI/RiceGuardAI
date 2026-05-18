import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Upload, FileText, Users, MessageSquare, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";

async function fetchKpis() {
  const [scans, detections, advisories, farmers] = await Promise.all([
    supabase.from("drone_scans").select("id", { count: "exact", head: true }),
    supabase.from("disease_detections").select("severity", { count: "exact" }),
    supabase.from("advisories").select("state,sms_status", { count: "exact" }),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "farmer"),
  ]);

  const detectionsBySeverity = (detections.data ?? []).reduce<Record<string, number>>(
    (acc, row) => {
      acc[row.severity] = (acc[row.severity] ?? 0) + 1;
      return acc;
    },
    {}
  );
  const advisoriesByState = (advisories.data ?? []).reduce<Record<string, number>>(
    (acc, row) => {
      acc[row.state] = (acc[row.state] ?? 0) + 1;
      return acc;
    },
    {}
  );
  const smsSentToday = (advisories.data ?? []).filter(
    (r) => r.sms_status === "sent"
  ).length;

  return {
    scans: scans.count ?? 0,
    detections: detections.count ?? 0,
    detectionsBySeverity,
    advisoriesPending: (advisoriesByState.draft ?? 0) + (advisoriesByState.approved ?? 0),
    smsSentToday,
    farmers: farmers.count ?? 0,
  };
}

export function AdminOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-kpis"],
    queryFn: fetchKpis,
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">
            Admin Console
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold">Overview</h1>
        </div>
        <Link
          to="/admin/scans/new"
          className="inline-flex items-center gap-2 rounded-xl bg-forest-900 hover:bg-forest-950 text-white font-semibold px-5 py-2.5"
        >
          <Upload size={18} /> New Scan
        </Link>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<Upload />}
          label="Drone scans"
          value={isLoading ? "—" : data!.scans}
          to="/admin/scans"
        />
        <KpiCard
          icon={<AlertTriangle />}
          label="Detections"
          value={isLoading ? "—" : data!.detections}
          to="/admin/map"
        />
        <KpiCard
          icon={<FileText />}
          label="Advisories pending"
          value={isLoading ? "—" : data!.advisoriesPending}
          to="/admin/advisories"
        />
        <KpiCard
          icon={<Users />}
          label="Registered farmers"
          value={isLoading ? "—" : data!.farmers}
          to="/admin/farmers"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-stone-200 p-6">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">
            Detections by severity
          </div>
          <div className="mt-4 space-y-3">
            {["high", "medium", "low"].map((s) => {
              const count = data?.detectionsBySeverity[s] ?? 0;
              const total = data?.detections ?? 1;
              const pct = total ? Math.round((count / total) * 100) : 0;
              const color = s === "high" ? "#ef4444" : s === "medium" ? "#eab308" : "#22c55e";
              return (
                <div key={s}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="capitalize">{s}</span>
                    <span className="text-stone-500">{count}</span>
                  </div>
                  <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-stone-200 p-6">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">
            SMS sent (lifetime)
          </div>
          <div className="font-display text-5xl font-bold mt-3 flex items-center gap-3">
            <MessageSquare className="text-rice-600" size={36} />
            {data?.smsSentToday ?? 0}
          </div>
          <div className="text-sm text-stone-500 mt-2">
            All approved advisories delivered through SMS Gate.
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  to,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="bg-white rounded-2xl border border-stone-200 p-5 hover:border-forest-300 transition"
    >
      <div className="flex items-center justify-between">
        <div className="w-10 h-10 rounded-xl bg-forest-50 text-forest-800 grid place-items-center">
          {icon}
        </div>
      </div>
      <div className="font-display text-3xl font-bold mt-4">{value}</div>
      <div className="text-sm text-stone-500 mt-1">{label}</div>
    </Link>
  );
}
