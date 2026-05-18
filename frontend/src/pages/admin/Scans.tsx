import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Upload, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { DroneScan } from "@/types/database";
import { formatDistanceToNow } from "date-fns";

async function listScans() {
  const { data, error } = await supabase
    .from("drone_scans")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DroneScan[];
}

export function AdminScans() {
  const { data: scans = [], isLoading } = useQuery({
    queryKey: ["scans"],
    queryFn: listScans,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">
            Drone Scans
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold">Scan history</h1>
        </div>
        <Link
          to="/admin/scans/new"
          className="inline-flex items-center gap-2 rounded-xl bg-forest-900 hover:bg-forest-950 text-white font-semibold px-5 py-2.5"
        >
          <Plus size={18} /> New scan
        </Link>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
        {isLoading && <div className="p-8 text-center text-stone-400">Loading…</div>}
        {!isLoading && scans.length === 0 && (
          <div className="p-12 text-center">
            <Upload size={48} className="mx-auto text-stone-300" />
            <div className="font-display text-xl font-bold mt-3">No scans yet</div>
            <p className="text-stone-500 mt-1">Upload your first drone scan to start.</p>
          </div>
        )}
        {scans.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-stone-50 text-stone-500">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Name</th>
                  <th className="text-left px-5 py-3 font-medium">Source</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                  <th className="text-left px-5 py-3 font-medium whitespace-nowrap">Captured</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {scans.map((s) => (
                  <tr key={s.id} className="hover:bg-stone-50">
                    <td className="px-5 py-3 font-medium">{s.scan_name}</td>
                    <td className="px-5 py-3 text-stone-500">{s.source_type ?? "—"}</td>
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 rounded-full bg-stone-100 text-xs">
                        {s.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-stone-500 whitespace-nowrap">
                      {s.captured_at
                        ? formatDistanceToNow(new Date(s.captured_at), { addSuffix: true })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
