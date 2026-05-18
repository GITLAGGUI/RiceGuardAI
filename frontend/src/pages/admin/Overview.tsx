import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Upload,
  FileText,
  Users,
  MessageSquare,
  AlertTriangle,
  TrendingUp,
  Activity,
  Wheat,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

async function fetchKpis() {
  const [scans, detections, advisories, farmers, admins, recentDetections] = await Promise.all([
    supabase.from("drone_scans").select("id", { count: "exact", head: true }),
    supabase.from("disease_detections").select("severity,disease,created_at", { count: "exact" }),
    supabase.from("advisories").select("state,sms_status,created_at", { count: "exact" }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "farmer"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin"),
    supabase
      .from("disease_detections")
      .select("id,disease,severity,location_text,created_at")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const detectionsBySeverity = (detections.data ?? []).reduce<Record<string, number>>(
    (acc, row) => {
      acc[row.severity] = (acc[row.severity] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const detectionsByDisease = (detections.data ?? []).reduce<Record<string, number>>(
    (acc, row) => {
      acc[row.disease] = (acc[row.disease] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const advisoriesByState = (advisories.data ?? []).reduce<Record<string, number>>(
    (acc, row) => {
      acc[row.state] = (acc[row.state] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const smsSent = (advisories.data ?? []).filter((r) => r.sms_status === "sent").length;

  return {
    scans: scans.count ?? 0,
    detections: detections.count ?? 0,
    detectionsBySeverity,
    detectionsByDisease,
    advisoriesPending: (advisoriesByState.draft ?? 0) + (advisoriesByState.approved ?? 0),
    advisoriesSent: advisoriesByState.sent ?? 0,
    smsSent,
    farmers: farmers.count ?? 0,
    admins: admins.count ?? 0,
    recentDetections: recentDetections.data ?? [],
  };
}

const DISEASE_LABEL: Record<string, string> = {
  rice_blast: "Rice Blast",
  bacterial_leaf_blight: "BLB",
  tungro: "Tungro",
};
const DISEASE_COLOR: Record<string, string> = {
  rice_blast: "bg-rose-500",
  bacterial_leaf_blight: "bg-amber-500",
  tungro: "bg-orange-500",
};
const SEVERITY_TONE: Record<string, string> = {
  high: "bg-rose-50 text-rose-700 ring-rose-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  low: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

export function AdminOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-kpis"],
    queryFn: fetchKpis,
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-8">
      {/* Hero header */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 text-white p-7 lg:p-9 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.18),transparent_50%)]" />
        <div className="absolute -right-8 -bottom-8 opacity-10">
          <Wheat size={220} strokeWidth={1} />
        </div>
        <div className="relative">
          <div className="flex items-center gap-2 text-emerald-300 text-xs uppercase tracking-widest font-semibold mb-2">
            <Sparkles size={14} /> Operations control
          </div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold leading-tight">
            Pulse of the field, in one screen.
          </h1>
          <p className="text-slate-300 mt-2 max-w-2xl">
            Live detection counts, advisory queue, SMS delivery, and member activity. Auto-refreshes every 30 seconds.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              to="/admin/scans/new"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-4 py-2.5 text-sm transition"
            >
              <Upload size={16} /> New Scan
            </Link>
            <Link
              to="/admin/advisories"
              className="inline-flex items-center gap-2 rounded-lg bg-white/10 hover:bg-white/15 ring-1 ring-white/20 text-white font-semibold px-4 py-2.5 text-sm transition"
            >
              <FileText size={16} /> Review queue
              {data && data.advisoriesPending > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-md bg-amber-400 text-slate-950 text-xs">
                  {data.advisoriesPending}
                </span>
              )}
            </Link>
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <KpiCard
          accent="emerald"
          icon={<Upload size={18} />}
          label="Drone scans"
          value={isLoading ? "—" : data!.scans}
          to="/admin/scans"
          hint="Total uploaded"
        />
        <KpiCard
          accent="rose"
          icon={<AlertTriangle size={18} />}
          label="Detections"
          value={isLoading ? "—" : data!.detections}
          to="/admin/map"
          hint={`${data?.detectionsBySeverity.high ?? 0} high severity`}
        />
        <KpiCard
          accent="amber"
          icon={<FileText size={18} />}
          label="Advisories pending"
          value={isLoading ? "—" : data!.advisoriesPending}
          to="/admin/advisories"
          hint="Awaiting review"
        />
        <KpiCard
          accent="sky"
          icon={<Users size={18} />}
          label="Members"
          value={isLoading ? "—" : data!.farmers + data!.admins}
          to="/admin/farmers"
          hint={`${data?.farmers ?? 0} farmers · ${data?.admins ?? 0} admin`}
        />
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Severity breakdown */}
        <div className="lg:col-span-2 bg-white rounded-2xl ring-1 ring-slate-200 p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="text-xs uppercase tracking-widest text-slate-500 font-semibold">
                Detections by severity
              </div>
              <h2 className="font-display text-lg font-bold text-slate-900 mt-0.5">
                Risk distribution
              </h2>
            </div>
            <div className="text-xs text-slate-400 flex items-center gap-1">
              <TrendingUp size={14} /> Live
            </div>
          </div>
          <div className="space-y-3.5">
            {(["high", "medium", "low"] as const).map((s) => {
              const count = data?.detectionsBySeverity[s] ?? 0;
              const total = data?.detections || 1;
              const pct = total ? Math.round((count / total) * 100) : 0;
              const color =
                s === "high" ? "bg-rose-500" : s === "medium" ? "bg-amber-500" : "bg-emerald-500";
              return (
                <div key={s}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="capitalize font-medium text-slate-700">{s} severity</span>
                    <span className="text-slate-500 font-mono">
                      {count} <span className="text-slate-400">· {pct}%</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${color}`}
                      style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Per-disease split */}
          <div className="mt-7 pt-5 border-t border-slate-100">
            <div className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-3">
              By disease
            </div>
            <div className="grid grid-cols-3 gap-3">
              {(["rice_blast", "bacterial_leaf_blight", "tungro"] as const).map((d) => {
                const count = data?.detectionsByDisease[d] ?? 0;
                return (
                  <div key={d} className="rounded-xl bg-slate-50 px-3 py-3">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className={`w-2 h-2 rounded-full ${DISEASE_COLOR[d]}`} />
                      {DISEASE_LABEL[d]}
                    </div>
                    <div className="font-display text-2xl font-bold text-slate-900 mt-1">
                      {count}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* SMS card + recent activity */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6">
            <div className="text-xs uppercase tracking-widest text-slate-500 font-semibold">
              SMS delivered
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="font-display text-4xl font-bold text-slate-900">
                {data?.smsSent ?? 0}
              </span>
              <span className="text-xs text-slate-400">all-time</span>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2 text-sm text-slate-500">
              <MessageSquare size={14} className="text-emerald-600" />
              via SMS Gate API
            </div>
          </div>

          <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6">
            <div className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-3">
              Queue snapshot
            </div>
            <div className="space-y-2.5 text-sm">
              <QueueRow label="Drafts" value={(data && data.advisoriesPending) || 0} tone="amber" />
              <QueueRow label="Sent" value={data?.advisoriesSent ?? 0} tone="emerald" />
            </div>
            <Link
              to="/admin/advisories"
              className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800"
            >
              Open advisories queue <ArrowRight size={12} />
            </Link>
          </div>
        </div>
      </div>

      {/* Recent detections feed */}
      <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-500 font-semibold">
              Activity
            </div>
            <h2 className="font-display text-lg font-bold text-slate-900 mt-0.5">
              Latest detections
            </h2>
          </div>
          <Link
            to="/admin/map"
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1"
          >
            See all <ArrowRight size={12} />
          </Link>
        </div>

        {isLoading && <div className="text-slate-400 text-sm py-8 text-center">Loading…</div>}
        {!isLoading && (data?.recentDetections.length ?? 0) === 0 && (
          <div className="text-slate-400 text-sm py-10 text-center flex flex-col items-center gap-2">
            <Activity size={28} className="text-slate-300" />
            Walang detection pa. Mag-upload ng drone scan para magsimula.
          </div>
        )}
        {(data?.recentDetections.length ?? 0) > 0 && (
          <ul className="divide-y divide-slate-100">
            {data!.recentDetections.map((d) => (
              <li key={d.id} className="py-3 flex items-center gap-4">
                <span className={`w-2 h-2 rounded-full ${DISEASE_COLOR[d.disease]} shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-slate-900">
                    {DISEASE_LABEL[d.disease]}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {d.location_text ?? "—"}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ${
                    SEVERITY_TONE[d.severity]
                  }`}
                >
                  {d.severity}
                </span>
                <span className="text-xs text-slate-400 hidden sm:block font-mono">
                  {new Date(d.created_at).toLocaleDateString("en-PH", {
                    month: "short",
                    day: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  to,
  hint,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  to: string;
  hint?: string;
  accent: "emerald" | "rose" | "amber" | "sky";
}) {
  const accentMap: Record<typeof accent, string> = {
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
    amber: "bg-amber-50 text-amber-600",
    sky: "bg-sky-50 text-sky-600",
  };
  return (
    <Link
      to={to}
      className="bg-white rounded-2xl ring-1 ring-slate-200 p-5 hover:ring-slate-300 hover:shadow-sm transition group"
    >
      <div className="flex items-center justify-between">
        <div className={`w-9 h-9 rounded-lg grid place-items-center ${accentMap[accent]}`}>
          {icon}
        </div>
        <ArrowRight
          size={14}
          className="text-slate-300 group-hover:text-slate-600 group-hover:translate-x-0.5 transition"
        />
      </div>
      <div className="font-display text-3xl font-bold mt-4 text-slate-900">{value}</div>
      <div className="text-sm font-medium text-slate-600 mt-0.5">{label}</div>
      {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
    </Link>
  );
}

function QueueRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "emerald";
}) {
  const dot = tone === "amber" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-slate-600">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        {label}
      </span>
      <span className="font-mono font-semibold text-slate-900">{value}</span>
    </div>
  );
}
