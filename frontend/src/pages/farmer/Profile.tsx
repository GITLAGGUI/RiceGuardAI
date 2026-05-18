import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { REGION_II } from "@/types/domain";
import { formatPhDisplay } from "@/utils/phone";

export function FarmerProfile() {
  const { profile, refreshProfile } = useAuth();
  const [form, setForm] = useState({
    full_name: "",
    province: "Isabela",
    municipality: "",
    barangay: "",
    farm_size_ha: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setForm({
      full_name: profile.full_name ?? "",
      province: profile.province ?? "Isabela",
      municipality: profile.municipality ?? "",
      barangay: profile.barangay ?? "",
      farm_size_ha: profile.farm_size_ha?.toString() ?? "",
    });
  }, [profile]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: form.full_name.trim(),
        province: form.province,
        municipality: form.municipality.trim(),
        barangay: form.barangay.trim(),
        farm_size_ha: form.farm_size_ha ? Number(form.farm_size_ha) : null,
      })
      .eq("id", profile.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await refreshProfile();
    toast.success("Na-update ang profile");
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <div className="text-stone-500 text-sm">Aking Profile</div>
        <h1 className="font-display text-3xl md:text-4xl font-bold">Mga Detalye</h1>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 p-6">
        <div className="text-xs font-semibold uppercase tracking-wider text-stone-500">
          Cellphone
        </div>
        <div className="font-display text-xl font-bold mt-1">
          {profile && formatPhDisplay(profile.phone)}
        </div>
        <div className="text-xs text-stone-400 mt-1">
          Para baguhin, kontakin ang admin.
        </div>
      </div>

      <form onSubmit={save} className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
        <Row label="Buong pangalan">
          <input
            type="text"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            className="form-input"
            required
          />
        </Row>
        <Row label="Lalawigan">
          <select
            value={form.province}
            onChange={(e) => setForm({ ...form, province: e.target.value })}
            className="form-input"
          >
            {REGION_II.provinces.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Row>
        <Row label="Munisipalidad">
          <input
            type="text"
            value={form.municipality}
            onChange={(e) => setForm({ ...form, municipality: e.target.value })}
            className="form-input"
            required
          />
        </Row>
        <Row label="Barangay">
          <input
            type="text"
            value={form.barangay}
            onChange={(e) => setForm({ ...form, barangay: e.target.value })}
            className="form-input"
            required
          />
        </Row>
        <Row label="Laki ng bukid (hectares)">
          <input
            type="number"
            step="0.1"
            min="0"
            value={form.farm_size_ha}
            onChange={(e) => setForm({ ...form, farm_size_ha: e.target.value })}
            className="form-input"
          />
        </Row>
        <button
          type="submit"
          disabled={busy}
          className="tap rounded-xl bg-forest-900 hover:bg-forest-950 text-white font-semibold px-8 py-4 transition disabled:opacity-50"
        >
          {busy ? "Sini-save…" : "I-save"}
        </button>
      </form>

      <style>{`
        .form-input {
          width: 100%;
          padding: 0.875rem 1rem;
          border-radius: 0.75rem;
          border: 1px solid var(--color-stone-300, #d6d3d1);
          outline: none;
        }
        .form-input:focus {
          border-color: #065f46;
          box-shadow: 0 0 0 4px rgb(209 250 229);
        }
      `}</style>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-stone-700 mb-2">{label}</span>
      {children}
    </label>
  );
}
