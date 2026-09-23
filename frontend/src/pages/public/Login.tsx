import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, KeyRound, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

type Step = "password" | "recovery" | "setup" | "mfa" | "enroll";

export function Login() {
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { session, profile, loading, profileLoading, aal, refreshAal } = useAuth();
  const authError = new URLSearchParams(location.hash.slice(1)).get("error_code");

  useEffect(() => {
    if (loading || profileLoading || !session || !profile) return;
    if (profile.role === "admin" && profile.is_active && aal === "aal2") {
      const destination = (location.state as { from?: string } | null)?.from || "/admin/overview";
      navigate(destination, { replace: true });
    } else if (profile.role === "admin" && profile.is_active && step === "password") {
      // An invitation or recovery link signs in without providing a password.
      // Let the administrator set one before enrolling an authenticator.
      setStep("setup");
    }
  }, [loading, profileLoading, session, profile, aal, step, location.state, navigate]);

  const prepareMfa = async () => {
    const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalData?.currentLevel === "aal2") {
      await refreshAal();
      navigate("/admin/overview", { replace: true });
      return;
    }
    const factors = await supabase.auth.mfa.listFactors();
    const verified = factors.data?.totp.find((factor) => factor.status === "verified");
    if (verified) {
      const challenge = await supabase.auth.mfa.challenge({ factorId: verified.id });
      if (challenge.error) throw challenge.error;
      setFactorId(verified.id);
      setChallengeId(challenge.data.id);
      setStep("mfa");
      return;
    }
    const enrollment = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "RiceGuardAI Admin" });
    if (enrollment.error) throw enrollment.error;
    setFactorId(enrollment.data.id);
    setQr(enrollment.data.totp.qr_code);
    setStep("enroll");
  };

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      const role = await supabase.from("profiles").select("role,is_active").eq("id", result.data.user.id).single();
      if (role.data?.role !== "admin" || !role.data?.is_active) {
        await supabase.auth.signOut();
        throw new Error("This account is not an active invited administrator.");
      }
      setPassword("");
      await prepareMfa();
    } catch (error) {
      toast.error((error as Error).message || "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const finishInvitation = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 12 || password !== confirmPassword) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword("");
      setConfirmPassword("");
      toast.success("Password saved. Set up your authenticator next.");
      await prepareMfa();
    } catch (error) {
      toast.error((error as Error).message || "Account setup failed");
    } finally {
      setBusy(false);
    }
  };

  const requestRecovery = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/login`,
      });
      if (error) throw error;
      // Do not disclose whether an address belongs to an administrator.
      setRecoverySent(true);
    } catch (error) {
      toast.error((error as Error).message || "Could not send the account setup link");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    try {
      if (step === "enroll") {
        const challenge = await supabase.auth.mfa.challenge({ factorId });
        if (challenge.error) throw challenge.error;
        const verification = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
        if (verification.error) throw verification.error;
      } else {
        const verification = await supabase.auth.mfa.verify({ factorId, challengeId, code });
        if (verification.error) throw verification.error;
      }
      await refreshAal();
      toast.success("Administrator identity verified.");
      navigate("/admin/overview", { replace: true });
    } catch (error) {
      toast.error((error as Error).message || "Invalid authenticator code");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0b2f23] grid place-items-center px-5 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="inline-flex items-center gap-2 text-white/65 hover:text-white mb-8 text-sm"><ArrowLeft size={16} /> Public website</Link>
        <section className="bg-white rounded-3xl p-8 md:p-10 shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 grid place-items-center text-emerald-900 mb-5">
            {step === "password" ? <LockKeyhole size={26} /> : <ShieldCheck size={26} />}
          </div>
          <p className="text-xs font-bold tracking-[.15em] text-emerald-700 uppercase">Invite-only workspace</p>
          <h1 className="text-3xl font-bold mt-2">RiceGuardAI Admin</h1>
          {authError === "otp_expired" && <p role="alert" className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">That one-time email link has expired or was already opened. Request a new account setup link below.</p>}
          {step === "password" ? (
            <form onSubmit={signIn} className="mt-7 space-y-4">
              <p className="text-stone-500">Sign in with the email and password issued to an active administrator.</p>
              <label className="block text-sm font-semibold text-stone-700"><span className="flex items-center gap-2 mb-2"><Mail size={16} /> Email</span><input className="w-full rounded-xl border border-stone-300 px-4 py-3.5" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label className="block text-sm font-semibold text-stone-700"><span className="flex items-center gap-2 mb-2"><KeyRound size={16} /> Password</span><input className="w-full rounded-xl border border-stone-300 px-4 py-3.5" type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <button className="w-full rounded-xl bg-[#153e2f] py-4 text-white font-bold disabled:opacity-50" disabled={busy}>{busy ? "Verifying…" : "Continue securely"}</button>
              <button type="button" className="w-full text-sm font-semibold text-emerald-800 underline" onClick={() => setStep("recovery")}>Need a new setup link?</button>
            </form>
          ) : step === "recovery" ? (
            <form onSubmit={requestRecovery} className="mt-7 space-y-4">
              <p className="text-stone-600">Request a new one-time link for your invited administrator account.</p>
              <label className="block text-sm font-semibold text-stone-700">Email<input className="mt-2 w-full rounded-xl border border-stone-300 px-4 py-3.5" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <button className="w-full rounded-xl bg-[#153e2f] py-4 text-white font-bold disabled:opacity-50" disabled={busy}>{busy ? "Sending…" : "Send account setup link"}</button>
              {recoverySent && <p role="status" className="text-sm text-emerald-900">If this email has an account, a new link is on its way. Open the newest email once, in this browser.</p>}
              <button type="button" className="w-full text-sm font-semibold text-emerald-800 underline" onClick={() => setStep("password")}>Back to sign in</button>
            </form>
          ) : step === "setup" ? (
            <form onSubmit={finishInvitation} className="mt-7 space-y-4">
              <p className="text-stone-500">Finish your invited account by creating a password. Your authenticator will be set up next.</p>
              <label className="block text-sm font-semibold text-stone-700">New password<input className="mt-2 w-full rounded-xl border border-stone-300 px-4 py-3.5" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <label className="block text-sm font-semibold text-stone-700">Confirm password<input className="mt-2 w-full rounded-xl border border-stone-300 px-4 py-3.5" type="password" autoComplete="new-password" required minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
              <button className="w-full rounded-xl bg-[#153e2f] py-4 text-white font-bold disabled:opacity-50" disabled={busy || password.length < 12 || password !== confirmPassword}>{busy ? "Saving…" : "Save password and set up MFA"}</button>
              <button className="w-full text-sm font-semibold text-emerald-800 underline" type="button" disabled={busy} onClick={() => void prepareMfa()}>I already have a password — continue to MFA</button>
            </form>
          ) : (
            <form onSubmit={verify} className="mt-7 space-y-4">
              <p className="text-stone-500">{step === "enroll" ? "Scan this QR code in an authenticator app, then enter the six-digit code. This is required for every administrator." : "Enter the current six-digit code from your authenticator app."}</p>
              {step === "enroll" && qr ? <img className="mx-auto w-52 h-52" src={qr} alt="TOTP enrollment QR code" /> : null}
              <input className="w-full rounded-xl border border-stone-300 px-4 py-4 text-center text-2xl tracking-[.45em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
              <button className="w-full rounded-xl bg-[#153e2f] py-4 text-white font-bold disabled:opacity-50" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : step === "enroll" ? "Activate MFA and continue" : "Verify and continue"}</button>
            </form>
          )}
          <p className="mt-6 text-xs text-stone-500">Farmer SMS registration and consent are separate from administrator authorization.</p>
        </section>
      </div>
    </main>
  );
}
