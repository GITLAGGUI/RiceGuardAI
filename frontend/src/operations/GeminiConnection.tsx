import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  connectorOwnerAction,
  ConnectorOwnerError,
  googleConnectorCallback,
  safeAdminReturnPath,
  type ConnectorGrant,
  type ConsentPreview,
} from "./geminiConnector";

type Loaded = { key: string | null; preview?: ConsentPreview; grants: ConnectorGrant[] };
const fieldClass = "mt-2 w-full rounded-lg border border-stone-300 px-3 py-3 text-base";
const dateLabel = (value: string) => new Date(value).toLocaleString();
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The connector action failed.";
const isExpiredError = (error: unknown) => error instanceof ConnectorOwnerError && /expir/.test(error.code);

export function GeminiConnectionPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const { session, profile, aal, loading, profileLoading } = useAuth();
  const authenticated = !loading && !profileLoading && !!session && profile?.role === "admin" && profile.is_active && aal === "aal2";
  const requestId = params.get("request");
  const invalidRequest = params.has("request") && (!requestId || !/^[A-Za-z0-9_-]{16,128}$/.test(requestId) || params.size !== 1);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<{ key: string | null; message: string; expired: boolean } | null>(null);
  const [error, setError] = useState("");
  const [surveyIds, setSurveyIds] = useState<string[]>([]);
  const [allowImages, setAllowImages] = useState(false);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState("");
  const pending = useRef(false);
  const [clientName, setClientName] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [credentials, setCredentials] = useState<{ client_id: string; client_secret: string } | null>(null);

  useEffect(() => {
    if (!authenticated || invalidRequest) return;
    let active = true;
    async function loadOwnerData() {
      try {
        const next = requestId
          ? { key: requestId, preview: await connectorOwnerAction<ConsentPreview>("preview", { request_id: requestId }), grants: [] }
          : { key: null, grants: (await connectorOwnerAction<{ grants: ConnectorGrant[] }>("grants", {})).grants };
        if (next.preview && (!next.preview.scopes?.length || next.preview.scopes.some((scope) => !["evidence:read", "advisory:submit"].includes(scope)) ||
          !Array.isArray(next.preview.eligible_surveys) || !Number.isFinite(Date.parse(next.preview.expires_at)))) {
          throw new Error("The connector returned invalid consent details. Restart the connection from Gemini.");
        }
        if (!Array.isArray(next.grants)) throw new Error("The connector returned invalid connection details.");
        if (active) {
          setLoaded(next);
          setLoadError(null);
          setSurveyIds([]);
          setAllowImages(false);
          setExpired(false);
          setError("");
        }
      } catch (failure) {
        if (active) setLoadError({ key: requestId, message: errorMessage(failure), expired: isExpiredError(failure) });
      }
    }
    void loadOwnerData();
    return () => { active = false; };
  }, [authenticated, invalidRequest, requestId]);

  const current = loaded?.key === requestId ? loaded : null;
  const preview = current?.preview;
  const requestExpired = expired || (!!preview && Date.parse(preview.expires_at) <= Date.now());
  useEffect(() => {
    if (!preview) return;
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, Date.parse(preview.expires_at) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [preview]);

  async function decide(decision: "allow" | "deny") {
    if (pending.current || !preview || requestExpired || (decision === "allow" && surveyIds.length === 0)) return;
    pending.current = true;
    setBusy(decision);
    setError("");
    try {
      const result = await connectorOwnerAction<{ redirect_uri: string }>("consent", {
        request_id: requestId,
        decision,
        survey_ids: decision === "allow" ? surveyIds : [],
        allow_images: decision === "allow" && allowImages,
      });
      window.location.assign(googleConnectorCallback(result.redirect_uri));
    } catch (failure) {
      setError(errorMessage(failure));
      if (isExpiredError(failure)) setExpired(true);
      pending.current = false;
      setBusy("");
    }
  }

  async function revoke(grantId: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(grantId);
    setError("");
    try {
      const result = await connectorOwnerAction<{ revoked: boolean }>("revoke", { grant_id: grantId });
      if (result.revoked !== true) throw new Error("Revocation was not confirmed. Please retry.");
      setLoaded((previous) => previous && ({ ...previous, grants: previous.grants.map((grant) => grant.id === grantId ? { ...grant, revoked_at: new Date().toISOString() } : grant) }));
    } catch (failure) { setError(errorMessage(failure)); }
    finally { pending.current = false; setBusy(""); }
  }

  async function registerClient(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !clientName.trim()) return;
    setError("");
    let callback: string;
    try { callback = googleConnectorCallback(redirectUri.trim()); }
    catch (failure) { setError(errorMessage(failure)); return; }
    pending.current = true;
    setBusy("register");
    setCredentials(null);
    try {
      const result = await connectorOwnerAction<{ client_id: string; client_secret: string }>("register-client", { client_name: clientName.trim(), redirect_uri: callback });
      if (!result.client_id || !result.client_secret) throw new Error("The connector did not return client credentials.");
      setCredentials(result);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { pending.current = false; setBusy(""); }
  }

  return (
    <div className="space-y-6" style={{ maxWidth: 850, margin: "0 auto" }}>
      <header className="rg-page-heading">
        <div><p className="rg-eyebrow">GEMINI CONNECTION</p><h1>RiceGuardAI Advisory</h1><p>Review the evidence Gemini may read and the private advisory it may save.</p></div>
      </header>
      {!authenticated ? <section className="rg-panel rg-form"><p>Administrator sign-in and MFA are required.</p><Link className="rg-text-link" to="/login" state={{ from: safeAdminReturnPath(location.pathname + location.search) }}>Continue to secure sign-in</Link></section> :
        invalidRequest ? <p role="alert">Invalid request. Restart the connection from Gemini.</p> :
        loadError?.key === requestId ? <p role="alert">{loadError.message}{loadError.expired && " Restart the connection from Gemini."}</p> :
        !current ? <p role="status">Checking connector owner authorization…</p> : <>
          {error && <p role="alert" className="rg-form-error">{error}</p>}
          {preview ? requestExpired ? <section className="rg-panel rg-form"><p role="alert">This request has expired. Restart the connection from Gemini.</p></section> :
            <section className="rg-panel rg-form" aria-label="Connection permissions">
              <h2>Connect {preview.app_name}</h2>
              <p>Mababasa ng Gemini ang pinili mong detection evidence at makakapag-save ng advisory. Hindi ito magpa-publish o magpapadala ng SMS sa setup test.</p>
              <p>The server verifies the configured connector owner and MFA for every action.</p>
              <div><h3 className="font-semibold">Requested permissions</h3><ul className="list-disc pl-6">{preview.scopes.map((scope) => <li key={scope}><code>{scope}</code> — {scope === "evidence:read" ? "read selected detection evidence" : "save a private advisory; Gemini may request write confirmation"}</li>)}</ul></div>
              <p>Access lasts at most 30 days. You can revoke it at any time.</p>
              <p>Request expires: <time dateTime={preview.expires_at}>{dateLabel(preview.expires_at)}</time></p>
              <fieldset className="space-y-3" disabled={!!busy}>
                <legend className="font-semibold mb-2">Choose surveys to share</legend>
                <p className="text-sm text-stone-600">Select at least one survey. Only the selected evidence is accessible.</p>
                {preview.eligible_surveys.map((survey) => <label key={survey.id} className="flex items-start gap-3 rounded-lg border border-stone-200 p-3"><input className="mt-1" type="checkbox" checked={surveyIds.includes(survey.id)} onChange={(event) => setSurveyIds((previous) => event.target.checked ? [...previous, survey.id] : previous.filter((id) => id !== survey.id))} /><span style={{ overflowWrap: "anywhere" }}>{survey.label}</span></label>)}
                {!preview.eligible_surveys.length && <p>No eligible surveys are available. Add an isolated fixture before restarting from Gemini.</p>}
              </fieldset>
              <label className="flex items-start gap-3 rounded-lg bg-stone-50 p-4"><input className="mt-1" type="checkbox" checked={allowImages} disabled={!!busy} onChange={(event) => setAllowImages(event.target.checked)} /><span><strong className="block">Share sanitized evidence images</strong><span className="text-sm text-stone-600">Optional. Off by default. Only bounded derivatives without EXIF, contact or location identifiers may be shared.</span></span></label>
              <div className="rg-inline"><button className="rg-button rg-primary" disabled={!!busy || !surveyIds.length} onClick={() => void decide("allow")}>{busy === "allow" ? "Saving…" : "Allow"}</button><button className="rg-button rg-secondary" disabled={!!busy} onClick={() => void decide("deny")}>{busy === "deny" ? "Denying…" : "Deny"}</button></div>
            </section> : <>
              <section className="rg-panel rg-form" aria-label="Existing connections">
                <h2>Existing connections</h2>
                {!current.grants.length && <p>No connections have been granted.</p>}
                {current.grants.map((grant) => {
                  const grantExpired = Date.parse(grant.expires_at) <= Date.now();
                  return <article key={grant.id} className="space-y-2 rounded-lg border border-stone-200 p-4">
                    <h3 className="font-semibold">{grant.app_name}</h3><p>{grant.scopes.join(", ")}</p><p>Expires: <time dateTime={grant.expires_at}>{dateLabel(grant.expires_at)}</time></p><p>Images: {grant.allow_images ? "on" : "off"} · {grant.survey_ids.length} selected survey(s)</p>
                    <p className="text-sm" style={{ overflowWrap: "anywhere" }}>Survey IDs: {grant.survey_ids.join(", ")}</p>
                    {grant.revoked_at ? <p role="status">Revoked</p> : grantExpired ? <p>Expired</p> : <button className="rg-button rg-secondary" disabled={!!busy} onClick={() => void revoke(grant.id)}>{busy === grant.id ? "Revoking…" : "Revoke"}</button>}
                  </article>;
                })}
              </section>
              <section className="rg-panel rg-form" aria-label="Owner client setup">
                <h2>Owner client setup</h2><p>Enter the exact Google callback shown by Gemini. Registering a client does not grant evidence access.</p>
                <form onSubmit={(event) => void registerClient(event)} className="space-y-4">
                  <label className="block font-semibold">Client name<input className={fieldClass} required maxLength={200} autoComplete="off" value={clientName} onChange={(event) => setClientName(event.target.value)} disabled={!!busy} /></label>
                  <label className="block font-semibold">Exact Google callback URL<input className={fieldClass} type="url" required autoComplete="off" spellCheck={false} value={redirectUri} onChange={(event) => setRedirectUri(event.target.value)} disabled={!!busy} /></label>
                  <button className="rg-button rg-primary" disabled={!!busy}>{busy === "register" ? "Registering…" : "Register client"}</button>
                </form>
                {credentials && <div role="region" aria-label="One-time client credentials" className="space-y-3 rounded-lg bg-amber-50 p-4" style={{ overflowWrap: "anywhere" }}><p>Shown once. Enter these privately in Gemini. Hiding this panel removes the secret from the page.</p><p>Client ID: <code>{credentials.client_id}</code></p><p>Client secret: <code>{credentials.client_secret}</code></p><button className="rg-button rg-secondary" onClick={() => setCredentials(null)}>Hide credentials</button></div>}
              </section>
            </>}
        </>}
      <Link className="rg-text-link" to="/admin/overview">Back to admin overview</Link>
    </div>
  );
}
