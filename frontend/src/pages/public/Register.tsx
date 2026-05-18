import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Phone, Wheat, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { normalizePhPhone, formatPhDisplay, formatPhInput } from "@/utils/phone";
import { REGION_II } from "@/types/domain";
import { useAuth } from "@/context/AuthContext";
import { authOtpErrorMessage } from "@/utils/authErrors";

type Step = "phone" | "otp" | "profile";

const OTP_EXPIRES_SECONDS = 5 * 60;
const RESEND_COOLDOWN_SECONDS = 30;

export function Register() {
  const [step, setStep] = useState<Step>("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [form, setForm] = useState({
    full_name: "",
    province: "Isabela",
    municipality: "",
    barangay: "",
    farm_size_ha: "",
  });
  const navigate = useNavigate();
  const location = useLocation();
  const { session, profile, loading, refreshProfile } = useAuth();

  useEffect(() => {
    if (step !== "otp" || !otpSentAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [step, otpSentAt]);

  const secondsSinceOtp = otpSentAt ? Math.floor((now - otpSentAt) / 1000) : 0;
  const secondsLeft = otpSentAt ? Math.max(0, OTP_EXPIRES_SECONDS - secondsSinceOtp) : 0;
  const resendSecondsLeft = otpSentAt
    ? Math.max(0, RESEND_COOLDOWN_SECONDS - secondsSinceOtp)
    : 0;
  const canResend = step === "otp" && !!phone && !busy && resendSecondsLeft === 0;

  // Pre-fill phone if Login bounced the user here for a not-yet-registered number.
  useEffect(() => {
    const state = location.state as { prefillPhone?: string } | null;
    const pref = state?.prefillPhone;
    if (pref && !phoneInput) {
      // pref is E.164 like "+639153683496" — show the local format in the input
      const local = pref.replace(/^\+63/, "");
      setPhoneInput(formatPhInput(local));
    }
    // intentionally only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the user lands here already authenticated (e.g. via Login on a phone
  // that has an auth row but no profile yet), skip the phone + OTP steps and
  // drop them straight into profile creation. This is the "naka-login na pero
  // wala pang profile" path.
  //
  // If they have a complete profile, send them to their home — no point in
  // showing the register form.
  useEffect(() => {
    if (loading) return;
    if (!session?.user) return;
    // A complete profile (with full_name) means registration is already done —
    // bounce them to their home so they don't see this page at all.
    if (profile && profile.full_name) {
      navigate(profile.role === "admin" ? "/admin/overview" : "/farmer/home", { replace: true });
      return;
    }
    // Authenticated + (no profile OR blank profile from auto-create trigger):
    // skip phone + OTP, drop into profile step. Pre-fill with whatever the
    // trigger already inserted, so we don't lose any partial data.
    const authPhone = profile?.phone || session.user.phone;
    if (authPhone) {
      const e164 = authPhone.startsWith("+") ? authPhone : `+${authPhone}`;
      setPhone(e164);
    }
    if (profile) {
      setForm((f) => ({
        ...f,
        full_name: profile.full_name ?? "",
        province: profile.province ?? f.province,
        municipality: profile.municipality ?? "",
        barangay: profile.barangay ?? "",
        farm_size_ha: profile.farm_size_ha != null ? String(profile.farm_size_ha) : "",
      }));
    }
    setStep("profile");
  }, [loading, session, profile, navigate]);

  const sendOtp = async (normalized: string, mode: "initial" | "resend") => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      phone: normalized,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) {
      console.warn("[register] OTP send failed", {
        normalizedPhone: normalized,
        message: error.message,
      });
      toast.error(authOtpErrorMessage(error.message, formatPhDisplay(normalized)));
      return;
    }
    setPhone(normalized);
    setOtp("");
    setOtpSentAt(Date.now());
    setNow(Date.now());
    setStep("otp");
    toast.success(
      mode === "resend"
        ? `Bagong code na-send sa ${formatPhDisplay(normalized)}`
        : `Code na-send sa ${formatPhDisplay(normalized)}`,
    );
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizePhPhone(phoneInput);
    if (!normalized) {
      toast.error("Mukhang mali ang number. Dapat 10 digits na nagsisimula sa 9 (hal. 912 345 6789).");
      return;
    }
    await sendOtp(normalized, "initial");
  };

  const handleResendOtp = async () => {
    if (!phone || !canResend) return;
    await sendOtp(phone, "resend");
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || otp.length !== 6) return;
    setBusy(true);
    try {
      // SDK occasionally hangs on verifyOtp response handling even though the
      // server-side verify already succeeded. Race with 8s timeout, and on
      // timeout fall back to getSession() — if session exists, verify worked.
      type VerifyResult = Awaited<ReturnType<typeof supabase.auth.verifyOtp>>;
      const verifyP: Promise<VerifyResult> = supabase.auth.verifyOtp({
        phone,
        token: otp,
        type: "sms",
      });
      const timeoutP = new Promise<"timeout">((res) => setTimeout(() => res("timeout"), 8000));
      const raced = await Promise.race([verifyP, timeoutP]);

      if (raced === "timeout") {
        console.warn("[register] verifyOtp hung; checking persisted session");
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session) {
          setStep("profile");
          return;
        }
        toast.error("Walang sagot ang server sa 8s. Pindutin ang Resend code para sa bagong OTP.");
        return;
      }

      const { error } = raced;
      if (error) {
        console.warn("[register] verify failed", error);
        toast.error(
          error.message?.toLowerCase().includes("expired")
            ? "Expired o luma na ang code. Pindutin ang Resend code para sa bagong OTP."
            : `Mali ang code. (${error.message})`,
        );
        return;
      }
      setStep("profile");
    } catch (err) {
      console.error("[register] verify threw", err);
      toast.error(`Hindi naverify. (${(err as Error)?.message ?? "unknown"})`);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      toast.error("Wala pang session. Subukang mag-login muli.");
      setBusy(false);
      return;
    }
    const { error } = await supabase.from("profiles").upsert({
      id: userData.user.id,
      phone,
      full_name: form.full_name.trim(),
      role: "farmer",
      province: form.province,
      municipality: form.municipality.trim(),
      barangay: form.barangay.trim(),
      farm_size_ha: form.farm_size_ha ? Number(form.farm_size_ha) : null,
      is_active: true,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await refreshProfile();
    toast.success("Tagumpay! Welcome sa RiceGuard.");
    navigate("/farmer/home");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-forest-950 via-forest-900 to-emerald-900 grid place-items-center px-5 py-10">
      <div className="w-full max-w-md">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-6 text-sm"
        >
          <ArrowLeft size={16} /> Bumalik
        </Link>

        <ProgressDots step={step} />

        <div className="bg-white rounded-3xl p-8 md:p-10 shadow-2xl mt-4">
          {step === "phone" && (
            <Section
              icon={<Phone size={26} />}
              title="Magrehistro"
              subtitle="Ano ang cellphone number mo? Doon padadalhan ang SMS na pag-alerto."
            >
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <div className="flex">
                    <span className="inline-flex items-center px-4 rounded-l-xl border border-r-0 border-stone-300 bg-stone-50 text-stone-600 font-medium select-none">
                      +63
                    </span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      placeholder="912 345 6789"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(formatPhInput(e.target.value))}
                      maxLength={12}
                      className="flex-1 px-4 py-3.5 rounded-r-xl border border-stone-300 focus:border-forest-600 focus:ring-2 focus:ring-forest-100 outline-none text-lg tracking-wide"
                      required
                    />
                  </div>
                  <p className="mt-2 text-xs text-stone-500">
                    Dapat magsimula sa <strong>9</strong> at 10 digits lahat.
                  </p>
                </div>
                <SubmitBtn busy={busy}>Padalhan ako ng Code</SubmitBtn>
              </form>
            </Section>
          )}

          {step === "otp" && (
            <Section
              icon={<KeyRound size={26} />}
              title="Ipasok ang Code"
              subtitle={`Tingnan ang SMS sa ${phone && formatPhDisplay(phone)}.`}
            >
              <form onSubmit={handleVerify} className="space-y-4">
                <div className="rounded-xl border border-rice-200 bg-rice-50 px-4 py-3 text-sm text-forest-900">
                  {secondsLeft > 0 ? (
                    <>Mag-eexpire ang code sa <strong>{formatSeconds(secondsLeft)}</strong>.</>
                  ) : (
                    <strong>Expired na ang code. Humingi ng bago.</strong>
                  )}
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  placeholder="000000"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  className="w-full px-4 py-5 rounded-xl border border-stone-300 focus:border-forest-600 outline-none text-3xl tracking-[0.6em] text-center font-mono"
                  autoFocus
                  required
                />
                <SubmitBtn busy={busy} disabled={otp.length !== 6}>
                  Patunayan
                </SubmitBtn>
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={!canResend}
                  className="w-full rounded-xl border border-stone-300 py-3 text-sm font-semibold text-forest-900 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {resendSecondsLeft > 0
                    ? `Resend code in ${resendSecondsLeft}s`
                    : "Resend code"}
                </button>
              </form>
            </Section>
          )}

          {step === "profile" && (
            <Section
              icon={<Wheat size={26} />}
              title="Ilang detalye tungkol sa bukid"
              subtitle="Para mas tama ang advisory at maipadala sa tamang lokasyon."
            >
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <Field label="Buong pangalan">
                  <input
                    type="text"
                    value={form.full_name}
                    onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                    placeholder="Juan Dela Cruz"
                    className="form-input"
                    required
                  />
                </Field>
                <Field label="Lalawigan">
                  <select
                    value={form.province}
                    onChange={(e) => setForm((f) => ({ ...f, province: e.target.value }))}
                    className="form-input"
                  >
                    {REGION_II.provinces.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Munisipalidad / Lungsod">
                  <input
                    type="text"
                    value={form.municipality}
                    onChange={(e) => setForm((f) => ({ ...f, municipality: e.target.value }))}
                    placeholder="Ilagan"
                    className="form-input"
                    required
                  />
                </Field>
                <Field label="Barangay">
                  <input
                    type="text"
                    value={form.barangay}
                    onChange={(e) => setForm((f) => ({ ...f, barangay: e.target.value }))}
                    placeholder="San Vicente"
                    className="form-input"
                    required
                  />
                </Field>
                <Field label="Laki ng bukid (hectares) — optional">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={form.farm_size_ha}
                    onChange={(e) => setForm((f) => ({ ...f, farm_size_ha: e.target.value }))}
                    placeholder="1.5"
                    className="form-input"
                  />
                </Field>
                <SubmitBtn busy={busy}>
                  Tapusin ang Pagrehistro <ArrowRight size={18} />
                </SubmitBtn>
              </form>
            </Section>
          )}
        </div>

        {step === "phone" && (
          <p className="text-white/60 text-sm text-center mt-6">
            May account na?{" "}
            <Link to="/login" className="text-rice-300 font-semibold hover:underline">
              Mag-login
            </Link>
          </p>
        )}
      </div>

      <style>{`
        .form-input {
          @apply w-full px-4 py-3.5 rounded-xl border border-stone-300 focus:border-forest-600 focus:ring-2 focus:ring-forest-100 outline-none text-base;
        }
      `}</style>
    </div>
  );
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="w-14 h-14 rounded-2xl bg-rice-100 grid place-items-center text-forest-800 mb-5">
        {icon}
      </div>
      <h1 className="font-display text-2xl md:text-3xl font-bold">{title}</h1>
      <p className="text-stone-500 mt-2">{subtitle}</p>
      <div className="mt-8">{children}</div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-stone-700 mb-2">{label}</span>
      {children}
    </label>
  );
}

function SubmitBtn({
  children,
  busy,
  disabled,
}: {
  children: React.ReactNode;
  busy: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="w-full tap rounded-xl bg-forest-900 hover:bg-forest-950 text-white font-semibold py-4 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
    >
      {busy ? "Sandali lang…" : children}
    </button>
  );
}

function ProgressDots({ step }: { step: Step }) {
  const steps: Step[] = ["phone", "otp", "profile"];
  const current = steps.indexOf(step);
  return (
    <div className="flex items-center gap-2 px-2">
      {steps.map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all flex-1 ${
            i <= current ? "bg-rice-400" : "bg-white/15"
          }`}
        />
      ))}
    </div>
  );
}
