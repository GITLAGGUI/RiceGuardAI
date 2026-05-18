import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, MessageSquare, Calendar } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import type { NotificationPreferences } from "@/types/database";

export function FarmerNotifications() {
  const { profile } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPreferences>({
    farmer_id: "",
    sms_enabled: true,
    critical_alerts: true,
    weekly_summary: false,
    updated_at: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from("notification_preferences")
      .select("*")
      .eq("farmer_id", profile.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setPrefs(data as NotificationPreferences);
        else setPrefs((p) => ({ ...p, farmer_id: profile.id }));
      });
  }, [profile?.id]);

  const save = async () => {
    if (!profile?.id) return;
    setBusy(true);
    const { error } = await supabase
      .from("notification_preferences")
      .upsert({ ...prefs, farmer_id: profile.id });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Na-save ang setting");
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="text-stone-500 text-sm">Mga Setting</div>
        <h1 className="font-display text-3xl md:text-4xl font-bold">Mga Notipikasyon</h1>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 divide-y divide-stone-100">
        <Toggle
          icon={<MessageSquare />}
          title="SMS notifications"
          desc="Tumanggap ng alerto sa pamamagitan ng SMS"
          checked={prefs.sms_enabled}
          onChange={(v) => setPrefs({ ...prefs, sms_enabled: v })}
        />
        <Toggle
          icon={<Bell />}
          title="Mga kritikal na alerto"
          desc="Mataas na severity lamang — para hindi madalas"
          checked={prefs.critical_alerts}
          onChange={(v) => setPrefs({ ...prefs, critical_alerts: v })}
        />
        <Toggle
          icon={<Calendar />}
          title="Lingguhang buod"
          desc="Tuwing Linggo ng umaga, summary ng nakaraang linggo"
          checked={prefs.weekly_summary}
          onChange={(v) => setPrefs({ ...prefs, weekly_summary: v })}
        />
      </div>

      <button
        onClick={save}
        disabled={busy}
        className="w-full md:w-auto tap rounded-xl bg-forest-900 hover:bg-forest-950 text-white font-semibold px-8 py-4 transition disabled:opacity-50"
      >
        {busy ? "Sini-save…" : "I-save ang Setting"}
      </button>
    </div>
  );
}

function Toggle({
  icon,
  title,
  desc,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="px-6 py-5 flex items-center gap-4 cursor-pointer">
      <div className="w-10 h-10 rounded-xl bg-stone-100 grid place-items-center text-stone-600">
        {icon}
      </div>
      <div className="flex-1">
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-stone-500">{desc}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <div className="w-12 h-7 bg-stone-200 peer-checked:bg-forest-900 rounded-full relative transition">
        <div
          className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </div>
    </label>
  );
}
