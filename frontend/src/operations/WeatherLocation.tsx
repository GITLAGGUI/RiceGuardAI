import { useEffect, useState } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { useSmsRegistration } from "./registrationStatus";

type Location = { code: string; name: string; level: string; parent_code: string | null };
const storageKey = "riceguard-weather-location-v1";
export function WeatherLocation({ onSelect }: { onSelect: (code: string) => void }) {
  const registration = useSmsRegistration();
  const [rows, setRows] = useState<Location[]>([]);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState(() => {
    try { return localStorage.getItem(storageKey) || ""; } catch { return ""; }
  });
  useEffect(() => {
    if (!supabaseConfigured) return;
    let active = true;
    void supabase.from("rg_locations").select("code,name,level,parent_code,rg_location_releases!inner(active)")
      .in("level", ["province", "municipality"]).eq("rg_location_releases.active", true).order("name")
      .then(({ data, error }) => { if (active) { setRows(data || []); setError(Boolean(error)); } });
    return () => { active = false; };
  }, []);
  const code = selected || registration.barangayCode || "";
  useEffect(() => { onSelect(code); }, [code, onSelect]);
  return <label className="rg-weather-location">Weather location · Region II
    <select aria-label="Weather location in Region II" value={selected} onChange={event => {
      setSelected(event.target.value);
      try { localStorage.setItem(storageKey, event.target.value); } catch { /* Selection still works. */ }
    }}>
      <option value="">{registration.barangayCode ? "My registered farm area" : "Select your municipality"}</option>
      {rows.filter(row => row.level === "province").map(province => <optgroup key={province.code} label={province.name}>
        {rows.filter(row => row.level === "municipality" && row.parent_code === province.code).map(city => <option key={city.code} value={city.code}>{city.name}</option>)}
      </optgroup>)}
    </select>
    {error ? <small role="alert">Location list unavailable. Please try again later.</small> : <small>Weather follows your selected area, not the first bulletin post.</small>}
  </label>;
}
