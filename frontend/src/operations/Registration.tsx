import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Smartphone, ShieldCheck, ArrowRight, MapPin } from "lucide-react";
import { toast } from "sonner";
import { CommunityShell } from "./Public";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { normalizePhone } from "./domain";
import { operation } from "./store";
interface Location {
  code: string;
  name: string;
  level: string;
  parent_code: string | null;
}
export function RegistrationPage({
  preferences = false,
}: {
  preferences?: boolean;
}) {
  const { user } = useAuth();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationError, setLocationError] = useState(false);
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [barangay, setBarangay] = useState("");
  const [consent, setConsent] = useState(false);
  useEffect(() => {
    if (supabaseConfigured) {
      void supabase
        .from("rg_locations")
        .select("code,name,level,parent_code,rg_location_releases!inner(active)")
        .eq("rg_location_releases.active", true)
        .order("name")
        .limit(10000)
        .then(({ data, error }) => {
          setLocationError(Boolean(error));
          setLocations((data || []) as Location[]);
        });
    }
  }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  const send = async () => {
    setBusy(true);
    try {
      if (!supabaseConfigured)
        throw new Error(
          "Hindi pa configured ang live SMS registration. Walang OTP na ipinadala.",
        );
      const formatted = normalizePhone(phone);
      const { error } = await supabase.auth.signInWithOtp({
        phone: formatted,
        options: { shouldCreateUser: !preferences },
      });
      if (error) throw error;
      setSent(true);
      setCooldown(60);
      toast.success("Hiniling ang OTP. Tingnan ang inyong SMS.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: normalizePhone(phone),
        token: otp,
        type: "sms",
      });
      if (error) throw error;
      toast.success("Na-verify ang numero.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await operation("register-contact", {
        name: f.get("name"),
        barangay_code: barangay,
        consent,
      });
      toast.success(
        "Na-save ang registration. Ipa-register ang inyong farm pin sa operator para sa nearby alerts.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <CommunityShell active="sms">
      <section className="rg-registration">
        <div className="rg-registration-story">
          <span className="rg-eyebrow">PARA SA MAGSASAKA</span>
          <h1>
            {preferences
              ? "Ikaw ang may kontrol sa iyong alerts."
              : "Balita sa palayan, diretso sa iyong cellphone."}
          </h1>
          <p>
            Hindi kailangang mag-login araw-araw. Kapag may sinuring advisory
            malapit sa iyong registered farm, maaari kang makatanggap ng SMS.
          </p>
          <div className="rg-registration-benefits">
            <div>
              <Smartphone />
              <strong>SMS muna</strong>
              <p>Nababasa kahit walang mobile data.</p>
            </div>
            <div>
              <ShieldCheck />
              <strong>May pahintulot</strong>
              <p>Ikaw ang pipili kung tatanggap ng alerts.</p>
            </div>
            <div>
              <MapPin />
              <strong>Malapit sa bukid</strong>
              <p>Registered farms within 3 km, hindi tirahan.</p>
            </div>
          </div>
          <Link to="/bulletin" className="rg-text-link">
            Basahin muna ang mga advisory <ArrowRight size={17} />
          </Link>
        </div>
        <section className="rg-panel rg-registration-form">
          <span className="rg-eyebrow">
            {user ? "02 · CONTACT PREFERENCES" : "01 · I-VERIFY ANG NUMERO"}
          </span>
          <h2>{preferences ? "SMS preferences" : "Magparehistro sa SMS"}</h2>
          {!user ? (
            <>
              <label>
                Mobile number
                <input
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="09XXXXXXXXX"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setSent(false);
                  }}
                />
              </label>
              <button
                className="rg-button rg-primary"
                disabled={busy || cooldown > 0}
                onClick={() => void send()}
              >
                {cooldown
                  ? `Muling mag-request sa ${cooldown}s`
                  : sent
                    ? "Ipadala muli ang code"
                    : "Ipadala ang verification code"}
              </button>
              {sent && (
                <>
                  <label>
                    Verification code
                    <input
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      maxLength={8}
                    />
                  </label>
                  <button
                    className="rg-button rg-primary"
                    disabled={busy || otp.length < 6}
                    onClick={() => void verify()}
                  >
                    I-verify ang code
                  </button>
                </>
              )}
              <p className="rg-muted">
                Huwag ibahagi ang code. OTP verification lang ito; hiwalay ang
                pahintulot para sa advisory SMS.
              </p>
              {!supabaseConfigured && (
                <div className="rg-notice">
                  Hindi pa available ang SMS verification ngayon.
                </div>
              )}
            </>
          ) : (
            <form onSubmit={save}>
              <label>
                Pangalan
                <input name="name" autoComplete="name" required />
              </label>
              <label>
                Probinsya
                <select
                  value={province}
                  onChange={(e) => {
                    setProvince(e.target.value);
                    setCity("");
                    setBarangay("");
                  }}
                  required
                >
                  <option value="">Pumili ng probinsya</option>
                  {locations
                    .filter((l) => l.level === "province")
                    .map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Lungsod / Bayan
                <select
                  value={city}
                  onChange={(e) => {
                    setCity(e.target.value);
                    setBarangay("");
                  }}
                  required
                  disabled={!province}
                >
                  <option value="">Pumili ng bayan</option>
                  {locations
                    .filter((l) => l.parent_code === province)
                    .map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Barangay
                <select
                  value={barangay}
                  onChange={(e) => setBarangay(e.target.value)}
                  required
                  disabled={!city}
                >
                  <option value="">Pumili ng barangay</option>
                  {locations
                    .filter((l) => l.parent_code === city)
                    .map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </label>
              {locationError && (
                <div className="rg-notice">
                  Hindi ma-load ang Region II location list. Pakisubukan muli
                  bago i-save ang registration.
                </div>
              )}
              <label className="rg-check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                Pumapayag akong tumanggap ng reviewed RiceGuardAI advisory SMS.
                Maaari akong mag-reply ng STOP o bawiin ito sa preferences.
              </label>
              <button
                className="rg-button rg-primary"
                disabled={busy || !barangay}
              >
                I-save ang preferences
              </button>
              {preferences && (
                <button
                  type="button"
                  className="rg-button rg-secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await operation("opt-out");
                      setConsent(false);
                      toast.success("Advisory SMS stopped.");
                    } catch (e) {
                      toast.error((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Ihinto ang advisory SMS
                </button>
              )}
            </form>
          )}
          <small>
            Pribado ang inyong numero at eksaktong farm location. Walang
            awtomatikong pag-post ng personal information.
          </small>
        </section>
      </section>
    </CommunityShell>
  );
}
