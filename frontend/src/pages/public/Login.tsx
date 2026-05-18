import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Phone, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { normalizePhPhone, formatPhDisplay, formatPhInput } from "@/utils/phone";
import { authOtpErrorMessage } from "@/utils/authErrors";

type Step = "phone" | "otp";

const OTP_EXPIRES_SECONDS = 5 * 60;
const RESEND_COOLDOWN_SECONDS = 30;

export function Login() {
  const [step, setStep] = useState<Step>("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const navigate = useNavigate();
  const { session, profile, loading, profileLoading } = useAuth();

  // If the user is already signed in (session persisted in localStorage), don't
  // make them log in again. Send them to their dashboard. Closing the tab or
  // browser keeps the session — only an explicit Sign out clears it.
  useEffect(() => {
    if (loading || profileLoading) return;
    if (!session?.user) return;
    if (profile && profile.full_name) {
      navigate(profile.role === "admin" ? "/admin/overview" : "/farmer/home", { replace: true });
    } else {
      // Signed in but profile incomplete — finish via /register's profile step.
      navigate("/register", { replace: true });
    }
  }, [loading, profileLoading, session, profile, navigate]);

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

  const sendOtp = async (normalized: string, mode: "initial" | "resend") => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      phone: normalized,
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    if (error) {
      console.warn("[login] OTP send failed", {
        normalizedPhone: normalized,
        message: error.message,
      });
      // Truly-new-user case: no auth row → bounce to /register with the phone
      // pre-filled so they don't have to retype it.
      const msg = error.message.toLowerCase();
      if (
        msg.includes("signups not allowed") ||
        msg.includes("user not found") ||
        msg.includes("not_found")
      ) {
        toast.info("Wala pang account sa numerong ito. Idi-redirect ka na sa pagrehistro.");
        navigate("/register", { state: { prefillPhone: normalized } });
        return;
      }
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
      // Bypass supabase.auth.verifyOtp() — its response handling hangs in
      // production. Hit the REST endpoint directly, then register the new
      // session with the SDK via setSession() so AuthContext picks it up.
      const url = import.meta.env.VITE_SUPABASE_URL;
      const apikey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(`${url}/auth/v1/verify`, {
        method: "POST",
        headers: { apikey, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "sms", phone, token: otp }),
      });
      const body = await res.json();

      if (!res.ok) {
        const msg = (body.error_description || body.msg || body.error || "verify failed") as string;
        console.warn("[login] verify rejected", body);
        toast.error(
          msg.toLowerCase().includes("expired") || msg.toLowerCase().includes("invalid")
            ? "Expired o mali ang code. Pindutin ang Resend code para sa bagong OTP."
            : `Mali ang code. (${msg})`,
        );
        return;
      }

      // setSession() should be fast; race with a 3s timeout just in case.
      const setP = supabase.auth.setSession({
        access_token: body.access_token,
        refresh_token: body.refresh_token,
      });
      const timeoutP = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 3000));
      const raced = await Promise.race([setP, timeoutP]);

      toast.success("Welcome!");
      if (raced === "timeout") {
        // SDK is being slow — force a hard navigation so the next page load
        // re-initialises the client from localStorage (which setSession already
        // wrote synchronously before its observer chain).
        window.location.href = "/farmer/home";
        return;
      }
      // ProtectedRoute will route admins to /admin/overview and bounce
      // incomplete profiles to /register.
      navigate("/farmer/home");
    } catch (err) {
      console.error("[login] verify threw", err);
      toast.error(`Hindi naverify. (${(err as Error)?.message ?? "unknown"})`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-forest-950 via-forest-900 to-emerald-900 grid place-items-center px-5 py-10">
      <div className="w-full max-w-md">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-8 text-sm"
        >
          <ArrowLeft size={16} /> Bumalik
        </Link>

        <div className="bg-white rounded-3xl p-8 md:p-10 shadow-2xl">
          {step === "phone" ? (
            <>
              <div className="w-14 h-14 rounded-2xl bg-rice-100 grid place-items-center text-forest-800 mb-5">
                <Phone size={26} />
              </div>
              <h1 className="font-display text-3xl font-bold">Mag-login</h1>
              <p className="text-stone-500 mt-2">
                Ipasok ang iyong cellphone number. Padadalhan ka namin ng 6-digit na code.
              </p>

              <form onSubmit={handleSendOtp} className="mt-8 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-2">
                    Cellphone number
                  </label>
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

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full tap rounded-xl bg-forest-900 hover:bg-forest-950 text-white font-semibold py-4 transition disabled:opacity-50"
                >
                  {busy ? "Naghahatid…" : "Padalhan ako ng Code"}
                </button>
              </form>

              <p className="text-stone-500 text-sm text-center mt-6">
                Wala pang account?{" "}
                <Link to="/register" className="text-forest-800 font-semibold hover:underline">
                  Magrehistro
                </Link>
              </p>
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-2xl bg-rice-100 grid place-items-center text-forest-800 mb-5">
                <KeyRound size={26} />
              </div>
              <h1 className="font-display text-3xl font-bold">Ipasok ang Code</h1>
              <p className="text-stone-500 mt-2">
                Tingnan ang SMS sa <strong>{phone && formatPhDisplay(phone)}</strong>.
              </p>

              <form onSubmit={handleVerify} className="mt-8 space-y-4">
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
                  className="w-full px-4 py-5 rounded-xl border border-stone-300 focus:border-forest-600 focus:ring-2 focus:ring-forest-100 outline-none text-3xl tracking-[0.6em] text-center font-mono"
                  autoFocus
                  required
                />

                <button
                  type="submit"
                  disabled={busy || otp.length !== 6}
                  className="w-full tap rounded-xl bg-forest-900 hover:bg-forest-950 text-white font-semibold py-4 transition disabled:opacity-50"
                >
                  {busy ? "Sini-check…" : "Patunayan"}
                </button>
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

              <button
                onClick={() => {
                  setStep("phone");
                  setOtp("");
                }}
                className="block mx-auto mt-6 text-sm text-stone-500 hover:text-stone-800"
              >
                Mali ang number? Bumalik
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
