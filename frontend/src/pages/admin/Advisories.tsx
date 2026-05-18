import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listAdvisoriesByState } from "@/services/advisories";
import { DISEASE_LABEL, SEVERITY_LABEL } from "@/types/domain";
import { formatDistanceToNow } from "date-fns";
import { FileText } from "lucide-react";

export function AdminAdvisories() {
  const { data: advisories = [], isLoading } = useQuery({
    queryKey: ["all-advisories"],
    queryFn: () => listAdvisoriesByState("all"),
  });

  const buckets = {
    draft: advisories.filter((a) => a.state === "draft"),
    approved: advisories.filter((a) => a.state === "approved"),
    sent: advisories.filter((a) => a.state === "sent"),
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">
          Advisories
        </div>
        <h1 className="font-display text-3xl md:text-4xl font-bold">Advisory queue</h1>
      </div>

      {isLoading && <div className="text-stone-400 text-center py-8">Loading…</div>}

      {!isLoading && advisories.length === 0 && (
        <div className="bg-white rounded-2xl border border-stone-200 px-6 py-16 text-center">
          <FileText size={48} className="mx-auto text-stone-300" />
          <div className="font-display text-xl font-bold mt-3">No advisories yet</div>
          <p className="text-stone-500 mt-1">
            Save a scan with detections to auto-generate drafts.
          </p>
        </div>
      )}

      {(["draft", "approved", "sent"] as const).map((state) =>
        buckets[state].length > 0 ? (
          <div key={state}>
            <h2 className="font-display text-xl font-bold capitalize mb-3">
              {state} ({buckets[state].length})
            </h2>
            <div className="grid md:grid-cols-2 gap-3">
              {buckets[state].map((a) => (
                <Link
                  key={a.id}
                  to={`/admin/advisories/${a.id}`}
                  className="bg-white rounded-2xl border border-stone-200 p-5 hover:border-forest-300 transition"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ background: SEVERITY_LABEL[a.severity].color }}
                      />
                      <span className="font-semibold">{DISEASE_LABEL[a.disease].en}</span>
                    </div>
                    <span className="text-xs text-stone-500">
                      {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  {a.advice_text && (
                    <p className="text-sm text-stone-600 mt-2 line-clamp-2">
                      {a.advice_text}
                    </p>
                  )}
                  <div className="mt-3 flex gap-2 text-xs">
                    {a.ai_generated && (
                      <span className="px-2 py-0.5 rounded-full bg-rice-100 text-rice-800">
                        AI draft
                      </span>
                    )}
                    {a.sms_status && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                        SMS {a.sms_status}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null
      )}
    </div>
  );
}
