import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { listMyAdvisories } from "@/services/advisories";
import { DISEASE_LABEL, SEVERITY_LABEL } from "@/types/domain";
import { formatDistanceToNow } from "date-fns";
import { Bell, MessageSquare } from "lucide-react";

export function FarmerAlerts() {
  const { profile } = useAuth();
  const { data: advisories = [], isLoading } = useQuery({
    queryKey: ["alerts", profile?.id],
    queryFn: () => listMyAdvisories(profile!.id),
    enabled: !!profile?.id,
  });

  return (
    <div className="space-y-5">
      <div>
        <div className="text-stone-500 text-sm">Mga Alerto sa Sakit</div>
        <h1 className="font-display text-3xl md:text-4xl font-bold">Lahat ng Alerto</h1>
      </div>

      {isLoading && (
        <div className="text-center text-stone-400 py-12">Naglo-load…</div>
      )}

      {!isLoading && advisories.length === 0 && (
        <div className="bg-white rounded-2xl border border-stone-200 px-6 py-16 text-center">
          <Bell size={48} className="mx-auto text-stone-300" />
          <div className="font-display text-xl font-bold mt-4">Walang alerto pa</div>
          <p className="text-stone-500 mt-2">
            Padadalhan ka namin ng SMS kapag may natuklasang sakit malapit sa iyong bukid.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {advisories.map((a) => (
          <div
            key={a.id}
            className="bg-white rounded-2xl border border-stone-200 p-5"
          >
            <div className="flex items-start gap-3">
              <div
                className="w-3 h-3 rounded-full mt-2 flex-shrink-0"
                style={{ background: SEVERITY_LABEL[a.severity].color }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display font-bold text-lg">
                    {DISEASE_LABEL[a.disease].tl}
                  </h3>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background: SEVERITY_LABEL[a.severity].color + "20",
                      color: SEVERITY_LABEL[a.severity].color,
                    }}
                  >
                    {SEVERITY_LABEL[a.severity].tl}
                  </span>
                </div>
                <div className="text-xs text-stone-500 mt-0.5">
                  {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                </div>
                {a.advice_text && (
                  <p className="text-stone-700 mt-3 leading-relaxed whitespace-pre-wrap text-sm">
                    {a.advice_text}
                  </p>
                )}
                {a.sms_text && (
                  <div className="mt-3 p-3 rounded-lg bg-stone-50 border border-stone-100 flex gap-2">
                    <MessageSquare size={16} className="text-stone-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-stone-600">{a.sms_text}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
