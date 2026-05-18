import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Send, ArrowLeft, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { getAdvisory, updateAdvisory } from "@/services/advisories";
import { supabase } from "@/lib/supabase";
import { DISEASE_LABEL, SEVERITY_LABEL } from "@/types/domain";

const SMS_LIMIT = 280;

export function AdvisoryCompose() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: advisory, isLoading } = useQuery({
    queryKey: ["advisory", id],
    queryFn: () => getAdvisory(id),
    enabled: !!id,
  });

  const [adviceText, setAdviceText] = useState("");
  const [smsText, setSmsText] = useState("");

  useEffect(() => {
    if (advisory) {
      setAdviceText(advisory.advice_text ?? "");
      setSmsText(advisory.sms_text ?? "");
    }
  }, [advisory]);

  const callAdvisor = useMutation({
    mutationFn: async (mode: "field" | "sms") => {
      if (!advisory) throw new Error("No advisory");
      const { data, error } = await supabase.functions.invoke("ai-advisor", {
        body: {
          mode,
          disease: advisory.disease,
          severity: advisory.severity,
        },
      });
      if (error) throw error;
      return data as { text: string };
    },
  });

  const handleGenerateField = async () => {
    try {
      const res = await callAdvisor.mutateAsync("field");
      setAdviceText(res.text);
      toast.success("Generated Tagalog field advisory");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI failed");
    }
  };

  const handleGenerateSms = async () => {
    try {
      const res = await callAdvisor.mutateAsync("sms");
      setSmsText(res.text.slice(0, SMS_LIMIT));
      toast.success("Generated SMS draft");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI failed");
    }
  };

  const saveDraft = useMutation({
    mutationFn: async () => {
      await updateAdvisory(id, { advice_text: adviceText, sms_text: smsText });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["advisory", id] });
      toast.success("Saved");
    },
  });

  const approveAndSend = useMutation({
    mutationFn: async () => {
      if (!advisory) throw new Error("No advisory");
      // Persist any edits before sending.
      await updateAdvisory(id, {
        advice_text: adviceText,
        sms_text: smsText,
        state: "approved",
      });
      // send-sms looks up phone + checks notification prefs based on advisory_id.
      const { data, error } = await supabase.functions.invoke("send-sms", {
        body: { advisory_id: id },
      });
      if (error) throw error;
      const res = data as { ok: boolean; skipped?: boolean; reason?: string };
      if (res.skipped) {
        toast.info(`Skipped: ${res.reason ?? "farmer opted out"}`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-advisories"] });
      toast.success("SMS sent to farmer");
      navigate("/admin/advisories");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Send failed"),
  });

  if (isLoading || !advisory) return <div className="text-stone-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate("/admin/advisories")}
        className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-stone-800"
      >
        <ArrowLeft size={16} /> Back to queue
      </button>

      <div className="flex items-center gap-3 flex-wrap">
        <span
          className="px-3 py-1 rounded-full text-sm font-semibold"
          style={{
            background: SEVERITY_LABEL[advisory.severity].color + "20",
            color: SEVERITY_LABEL[advisory.severity].color,
          }}
        >
          {SEVERITY_LABEL[advisory.severity].en} severity
        </span>
        <h1 className="font-display text-3xl md:text-4xl font-bold">
          {DISEASE_LABEL[advisory.disease].en}
        </h1>
        <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100">
          {advisory.state}
        </span>
      </div>

      <div className="grid lg:grid-cols-[1.3fr_1fr] gap-4">
        <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Field advisory (Tagalog)</div>
            <button
              onClick={handleGenerateField}
              disabled={callAdvisor.isPending}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rice-100 hover:bg-rice-200 text-rice-800 text-sm font-medium transition"
            >
              <Sparkles size={16} />
              {callAdvisor.isPending ? "Generating…" : "Generate"}
            </button>
          </div>
          <textarea
            value={adviceText}
            onChange={(e) => setAdviceText(e.target.value)}
            rows={14}
            placeholder="Mga hakbang sa pamamahala ng sakit…"
            className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-forest-600 outline-none text-sm leading-relaxed"
          />
        </div>

        <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-semibold flex items-center gap-2">
              <MessageSquare size={18} /> SMS draft
            </div>
            <button
              onClick={handleGenerateSms}
              disabled={callAdvisor.isPending}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rice-100 hover:bg-rice-200 text-rice-800 text-sm font-medium transition"
            >
              <Sparkles size={16} />
              {callAdvisor.isPending ? "Generating…" : "Generate"}
            </button>
          </div>
          <textarea
            value={smsText}
            onChange={(e) => setSmsText(e.target.value.slice(0, SMS_LIMIT))}
            rows={6}
            placeholder="ALERTO: …"
            className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-forest-600 outline-none text-sm font-mono"
          />
          <div className="flex justify-between text-xs">
            <span className="text-stone-500">SMS preview, max {SMS_LIMIT} chars</span>
            <span
              className={
                smsText.length > SMS_LIMIT - 20 ? "text-red-500" : "text-stone-500"
              }
            >
              {smsText.length}/{SMS_LIMIT}
            </span>
          </div>

          <div className="pt-4 border-t border-stone-100 space-y-2">
            <button
              onClick={() => saveDraft.mutate()}
              disabled={saveDraft.isPending}
              className="w-full rounded-xl border border-stone-300 hover:bg-stone-50 px-4 py-3 text-sm font-medium transition"
            >
              {saveDraft.isPending ? "Saving…" : "Save draft"}
            </button>
            <button
              onClick={() => approveAndSend.mutate()}
              disabled={
                approveAndSend.isPending ||
                !smsText.trim() ||
                advisory.state === "sent"
              }
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-forest-900 hover:bg-forest-950 text-white font-semibold px-4 py-3 transition disabled:opacity-50"
            >
              <Send size={16} />
              {approveAndSend.isPending
                ? "Sending…"
                : advisory.state === "sent"
                  ? "Already sent"
                  : "Approve & send SMS"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
