import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Smartphone, ShieldCheck, ArrowRight, MapPin } from "lucide-react";
import { toast } from "sonner";
import { CommunityShell } from "./Public";
import { subscriberSupabase, supabase, supabaseConfigured } from "@/lib/supabase";
import { normalizePhone } from "./domain";
import { fieldOperation, registrationErrorMessage } from "./fieldOperations";
import { announceSmsRegistrationChange, useSmsRegistration } from "./registrationStatus";

interface Location {
  code: string;
  name: string;
  level: string;
  parent_code: string | null;
}

type SavedLocationPath = { province: string; city: string; barangay: string };

export function RegistrationPage({ preferences = false }: { preferences?: boolean }) {
  const registration = useSmsRegistration();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [formError, setFormError] = useState("");
  const [provinces, setProvinces] = useState<Location[]>([]);
  const [cities, setCities] = useState<Location[]>([]);
  const [barangays, setBarangays] = useState<Location[]>([]);
  const [locationError, setLocationError] = useState(false);
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [barangay, setBarangay] = useState("");
  const [savedPath, setSavedPath] = useState<SavedLocationPath | null>(null);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [saved, setSaved] = useState(false);

  const showError = (error: unknown) => {
    const message = registrationErrorMessage(error);
    setFormError(message);
    toast.error("Hindi nakumpleto ang request. Tingnan ang mensahe sa form.");
  };

  useEffect(() => {
    if (!supabaseConfigured) return;
    void supabase
      .from("rg_locations")
      .select("code,name,level,parent_code,rg_location_releases!inner(active)")
      .eq("level", "province")
      .eq("rg_location_releases.active", true)
      .order("name")
      .then(({ data, error }) => {
        setLocationError(Boolean(error));
        setProvinces((data || []) as Location[]);
      });
  }, []);

  useEffect(() => {
    setCities([]);
    setBarangays([]);
    if (!province || !supabaseConfigured) return;
    void supabase
      .from("rg_locations")
      .select("code,name,level,parent_code,rg_location_releases!inner(active)")
      .eq("level", "municipality")
      .eq("parent_code", province)
      .eq("rg_location_releases.active", true)
      .order("name")
      .then(({ data, error }) => {
        const rows = (data || []) as Location[];
        setLocationError(Boolean(error));
        setCities(rows);
        if (savedPath && rows.some((row) => row.code === savedPath.city)) setCity(savedPath.city);
      });
  }, [province, savedPath]);

  useEffect(() => {
    setBarangays([]);
    if (!city || !supabaseConfigured) return;
    void supabase
      .from("rg_locations")
      .select("code,name,level,parent_code,rg_location_releases!inner(active)")
      .eq("level", "barangay")
      .eq("parent_code", city)
      .eq("rg_location_releases.active", true)
      .order("name")
      .then(({ data, error }) => {
        const rows = (data || []) as Location[];
        setLocationError(Boolean(error));
        setBarangays(rows);
        if (savedPath && rows.some((row) => row.code === savedPath.barangay)) {
          setBarangay(savedPath.barangay);
          setSavedPath(null);
        }
      });
  }, [city, savedPath]);

  useEffect(() => {
    const code = registration.barangayCode;
    if (!code || !supabaseConfigured) return;
    let active = true;
    void (async () => {
      const { data: barangayRow } = await supabase
        .from("rg_locations")
        .select("code,parent_code")
        .eq("code", code)
        .maybeSingle();
      if (!barangayRow?.parent_code) return;
      const { data: cityRow } = await supabase
        .from("rg_locations")
        .select("code,parent_code")
        .eq("code", barangayRow.parent_code)
        .maybeSingle();
      if (!active || !cityRow?.parent_code) return;
      const path = { province: cityRow.parent_code, city: cityRow.code, barangay: barangayRow.code };
      setSavedPath(path);
      setProvince(path.province);
    })();
    return () => { active = false; };
  }, [registration.barangayCode]);

  useEffect(() => {
    if (registration.name) setName(registration.name);
    setConsent(registration.consent);
  }, [registration.consent, registration.name]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const send = async () => {
    setBusy(true);
    setFormError("");
    try {
      if (!supabaseConfigured) throw new Error("Hindi pa available ang live SMS registration.");
      const formatted = normalizePhone(phone);
      const { error } = await subscriberSupabase.auth.signInWithOtp({
        phone: formatted,
        options: { shouldCreateUser: !preferences },
      });
      if (error) throw error;
      setSent(true);
      setCooldown(60);
      toast.success("Naipadala ang verification code. Tingnan ang inyong SMS.");
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setFormError("");
    try {
      const { error } = await subscriberSupabase.auth.verifyOtp({
        phone: normalizePhone(phone),
        token: otp,
        type: "sms",
      });
      if (error) throw error;
      setSent(false);
      setOtp("");
      toast.success("Na-verify ang inyong mobile number.");
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      if (!consent) throw new Error("Kailangang lagyan ng check ang pahintulot upang makatanggap ng advisory SMS.");
      await fieldOperation("register-contact", {
        name,
        barangay_code: barangay,
        consent,
      }, subscriberSupabase);
      const next = await registration.refresh();
      announceSmsRegistrationChange();
      setSaved(true);
      toast.success("Na-save ang SMS registration.");
      if (!next.alertReady) {
        setFormError("Na-save ang numero at barangay. Kailangan pa ng farm pin bago maging handa ang 3 km nearby alerts.");
      }
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const changeNumber = async () => {
    await subscriberSupabase.auth.signOut();
    setSaved(false);
    setPhone("");
    setOtp("");
    setFormError("");
    announceSmsRegistrationChange();
  };

  const complete = (registration.registered || saved) && !preferences;

  return (
    <CommunityShell active="sms">
      <section className="rg-registration">
        <div className="rg-registration-story">
          <span className="rg-eyebrow">PARA SA MAGSASAKA</span>
          <h1>{preferences ? "Ikaw ang may kontrol sa iyong alerts." : "Balita sa palayan, diretso sa iyong cellphone."}</h1>
          <p>Hindi kailangang mag-login araw-araw. Kapag may sinuring advisory malapit sa iyong registered farm, maaari kang makatanggap ng SMS.</p>
          <div className="rg-registration-benefits">
            <div><Smartphone /><strong>SMS muna</strong><p>Nababasa kahit walang mobile data.</p></div>
            <div><ShieldCheck /><strong>May pahintulot</strong><p>Ikaw ang pipili kung tatanggap ng alerts.</p></div>
            <div><MapPin /><strong>Malapit sa bukid</strong><p>Registered farms within 3 km, hindi tirahan.</p></div>
          </div>
          <Link to="/bulletin" className="rg-text-link">Basahin muna ang mga advisory <ArrowRight size={17} /></Link>
        </div>

        <section className="rg-panel rg-registration-form" aria-busy={busy || registration.loading}>
          <span className="rg-eyebrow">{registration.authenticated ? "02 · CONTACT PREFERENCES" : "01 · I-VERIFY ANG NUMERO"}</span>
          <h2>{preferences ? "SMS preferences" : complete ? "Registered na ang SMS alerts" : "Magparehistro sa SMS"}</h2>

          {formError ? <div className="rg-form-error" role="alert">{formError}</div> : null}

          {registration.loading ? (
            <div className="rg-registration-loading" role="status">Sinusuri ang registration…</div>
          ) : complete ? (
            <div className="rg-registration-complete">
              <ShieldCheck size={38} />
              <strong>Na-save ang verified mobile number at barangay.</strong>
              <p>{registration.alertReady ? "Handa na ang account para sa nearby alerts ayon sa registered farm pin." : "Kailangan pa ng farm pin bago magamit ang 3 km nearby alerts."}</p>
              <Link className="rg-button rg-primary" to="/preferences">Buksan ang SMS preferences</Link>
            </div>
          ) : !registration.authenticated ? (
            <>
              <label>Mobile number
                <input autoComplete="tel" inputMode="tel" placeholder="09XXXXXXXXX" value={phone} onChange={(event) => { setPhone(event.target.value); setSent(false); setFormError(""); }} />
              </label>
              <button type="button" className="rg-button rg-primary" disabled={busy || cooldown > 0 || !phone.trim()} onClick={() => void send()}>
                {cooldown ? `Muling mag-request sa ${cooldown}s` : sent ? "Ipadala muli ang code" : "Ipadala ang verification code"}
              </button>
              {sent ? (
                <>
                  <label>Verification code
                    <input autoComplete="one-time-code" inputMode="numeric" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} maxLength={8} />
                  </label>
                  <button type="button" className="rg-button rg-primary" disabled={busy || otp.length < 6} onClick={() => void verify()}>I-verify ang code</button>
                </>
              ) : null}
              <p className="rg-muted">Huwag ibahagi ang code. Hiwalay ang phone verification sa administrator login at sa pahintulot para sa advisory SMS.</p>
              {!supabaseConfigured ? <div className="rg-notice">Hindi pa available ang SMS verification ngayon.</div> : null}
            </>
          ) : (
            <form onSubmit={save} noValidate>
              <label>Pangalan
                <input name="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} />
              </label>
              <label>Probinsya
                <select value={province} onChange={(event) => { setSavedPath(null); setProvince(event.target.value); setCity(""); setBarangay(""); }} required>
                  <option value="">Pumili ng probinsya</option>
                  {provinces.map((location) => <option key={location.code} value={location.code}>{location.name}</option>)}
                </select>
              </label>
              <label>Lungsod / Bayan
                <select value={city} onChange={(event) => { setSavedPath(null); setCity(event.target.value); setBarangay(""); }} required disabled={!province}>
                  <option value="">Pumili ng bayan</option>
                  {cities.map((location) => <option key={location.code} value={location.code}>{location.name}</option>)}
                </select>
              </label>
              <label>Barangay
                <select value={barangay} onChange={(event) => setBarangay(event.target.value)} required disabled={!city}>
                  <option value="">Pumili ng barangay</option>
                  {barangays.map((location) => <option key={location.code} value={location.code}>{location.name}</option>)}
                </select>
              </label>
              {locationError ? <div className="rg-notice">Hindi ma-load ang Region II location list. Pakisubukan muli bago i-save.</div> : null}
              <label className="rg-check">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />
                Pumapayag akong tumanggap ng reviewed RiceGuardAI advisory SMS. Maaari akong mag-reply ng STOP o bawiin ito sa preferences.
              </label>
              <button className="rg-button rg-primary" disabled={busy || !name.trim() || !barangay || !consent}>{busy ? "Sine-save…" : "I-save ang preferences"}</button>
              {preferences ? (
                <button type="button" className="rg-button rg-secondary" disabled={busy || !registration.registered} onClick={async () => {
                  setBusy(true);
                  setFormError("");
                  try {
                    await fieldOperation("opt-out", {}, subscriberSupabase);
                    setConsent(false);
                    await registration.refresh();
                    announceSmsRegistrationChange();
                    toast.success("Itinigil ang advisory SMS.");
                  } catch (error) {
                    showError(error);
                  } finally {
                    setBusy(false);
                  }
                }}>Ihinto ang advisory SMS</button>
              ) : null}
              <button type="button" className="rg-text-button" disabled={busy} onClick={() => void changeNumber()}>Gumamit ng ibang mobile number</button>
            </form>
          )}
          <small>Pribado ang inyong numero at eksaktong farm location. Walang awtomatikong pag-post ng personal information.</small>
        </section>
      </section>
    </CommunityShell>
  );
}
