import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, UserMinus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import type { Profile, UserRole } from "@/types/database";
import { formatPhDisplay } from "@/utils/phone";

async function listMembers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Profile[];
}

type Filter = "all" | "farmer" | "admin";

export function AdminFarmers() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["members"],
    queryFn: listMembers,
  });

  const toggleActive = useMutation({
    mutationFn: async (p: Profile) => {
      const { error } = await supabase
        .from("profiles")
        .update({ is_active: !p.is_active })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members"] });
      toast.success("Updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changeRole = useMutation({
    mutationFn: async ({ p, next }: { p: Profile; next: UserRole }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ role: next })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["members"] });
      toast.success(
        vars.next === "admin"
          ? `${vars.p.full_name ?? "User"} promoted to admin`
          : `${vars.p.full_name ?? "User"} demoted to farmer`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const visible = useMemo(
    () => (filter === "all" ? members : members.filter((m) => m.role === filter)),
    [members, filter],
  );

  const counts = useMemo(
    () => ({
      all: members.length,
      farmer: members.filter((m) => m.role === "farmer").length,
      admin: members.filter((m) => m.role === "admin").length,
    }),
    [members],
  );

  const onPromote = (p: Profile) => {
    if (!window.confirm(`Promote ${p.full_name ?? p.phone} to admin?\nThey will get full access to the admin dashboard.`)) {
      return;
    }
    changeRole.mutate({ p, next: "admin" });
  };

  const onDemote = (p: Profile) => {
    if (p.id === user?.id) {
      toast.error("Hindi mo pwedeng i-demote ang sarili mong account.");
      return;
    }
    if (!window.confirm(`Demote ${p.full_name ?? p.phone} to farmer?\nThey will lose admin access.`)) {
      return;
    }
    changeRole.mutate({ p, next: "farmer" });
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">
          Members
        </div>
        <h1 className="font-display text-3xl md:text-4xl font-bold">Registered users</h1>
        <p className="text-stone-500 mt-1">
          Manage roles and active status for everyone with a RiceGuard account.
        </p>
      </div>

      <div className="flex items-center gap-2">
        {(["all", "farmer", "admin"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f
                ? "bg-forest-900 text-white"
                : "bg-stone-100 text-stone-600 hover:bg-stone-200"
            }`}
          >
            {f === "all" ? "All" : f === "farmer" ? "Farmers" : "Admins"}{" "}
            <span className="opacity-60">({counts[f]})</span>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
        {isLoading && <div className="p-8 text-center text-stone-400">Loading…</div>}
        {!isLoading && visible.length === 0 && (
          <div className="p-12 text-center text-stone-500">No users in this view.</div>
        )}
        {visible.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Name</th>
                <th className="text-left px-5 py-3 font-medium">Phone</th>
                <th className="text-left px-5 py-3 font-medium">Role</th>
                <th className="text-left px-5 py-3 font-medium">Location</th>
                <th className="text-left px-5 py-3 font-medium">Farm size</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {visible.map((m) => {
                const isSelf = m.id === user?.id;
                return (
                  <tr key={m.id} className="hover:bg-stone-50">
                    <td className="px-5 py-3 font-medium">
                      {m.full_name ?? <span className="text-stone-400 italic">(no name)</span>}
                      {isSelf && (
                        <span className="ml-2 text-xs text-stone-400">(you)</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-stone-500 font-mono">
                      {formatPhDisplay(m.phone)}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          m.role === "admin"
                            ? "bg-forest-900 text-rice-200"
                            : "bg-stone-100 text-stone-600"
                        }`}
                      >
                        {m.role}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-stone-500">
                      {m.barangay ? `${m.barangay}, ${m.municipality}` : "—"}
                    </td>
                    <td className="px-5 py-3 text-stone-500">
                      {m.farm_size_ha ? `${m.farm_size_ha} ha` : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          m.is_active
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-stone-100 text-stone-500"
                        }`}
                      >
                        {m.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-3">
                        {m.role === "farmer" ? (
                          <button
                            onClick={() => onPromote(m)}
                            disabled={changeRole.isPending}
                            className="inline-flex items-center gap-1 text-sm text-forest-800 hover:underline disabled:opacity-50"
                            title="Promote to admin"
                          >
                            <ShieldCheck size={14} />
                            Promote
                          </button>
                        ) : (
                          <button
                            onClick={() => onDemote(m)}
                            disabled={changeRole.isPending || isSelf}
                            className="inline-flex items-center gap-1 text-sm text-stone-600 hover:underline disabled:opacity-30 disabled:no-underline"
                            title={isSelf ? "Hindi pwede i-demote ang sarili" : "Demote to farmer"}
                          >
                            <UserMinus size={14} />
                            Demote
                          </button>
                        )}
                        <button
                          onClick={() => toggleActive.mutate(m)}
                          disabled={toggleActive.isPending}
                          className="text-sm text-stone-600 hover:underline disabled:opacity-50"
                        >
                          {m.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-stone-500">
        Tip: hindi mo pwedeng i-demote ang sarili mong admin account — kailangang ibang admin
        ang gagawa nito para hindi maiwan na walang admin ang system.
      </p>
    </div>
  );
}
