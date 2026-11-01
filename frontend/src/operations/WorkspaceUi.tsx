// Shared workspace pieces: confirm and edit dialogs, the bell's to-do list and the SMS gateway card.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bell, CircleAlert, ClipboardCheck, MessageSquare, RotateCcw, X } from "lucide-react";
import { useOperations } from "./store";

/** Native modal dialog: focus is trapped, Escape closes, the page behind is inert. */
export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="rg-dialog" onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-label={title}>
      {open ? (
        <div className="rg-dialog-body">
          <header><h2>{title}</h2><button type="button" className="rg-icon-button" aria-label="Isara" onClick={onClose}><X size={18} /></button></header>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel, busy, onConfirm, onClose }: {
  open: boolean; title: string; body: ReactNode; confirmLabel: string; busy?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <div className="rg-dialog-text">{body}</div>
      <footer>
        <button type="button" className="rg-button rg-secondary" disabled={busy} onClick={onClose}>Huwag na</button>
        <button type="button" className="rg-button rg-danger" disabled={busy} onClick={onConfirm} autoFocus>{busy ? "Sandali…" : confirmLabel}</button>
      </footer>
    </Dialog>
  );
}

export type EditField = { name: string; label: string; value: string; required?: boolean; placeholder?: string; multiline?: boolean;
  inputMode?: "text" | "tel"; maxLength?: number; hint?: string };

export function EditDialog({ open, title, fields, busy, onSave, onClose }: {
  open: boolean; title: string; fields: EditField[]; busy?: boolean; onSave: (values: Record<string, string>) => void; onClose: () => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave(Object.fromEntries(fields.map((field) => [field.name, String(form.get(field.name) || "").trim()])));
  };
  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <form className="rg-dialog-form" onSubmit={submit}>
        {fields.map((field) => (
          <label key={field.name}>
            <span>{field.label}</span>
            {field.multiline
              ? <textarea name={field.name} defaultValue={field.value} required={field.required} maxLength={field.maxLength} rows={3} placeholder={field.placeholder} />
              : <input name={field.name} defaultValue={field.value} required={field.required} maxLength={field.maxLength}
                placeholder={field.placeholder} inputMode={field.inputMode} autoComplete="off" />}
            {field.hint ? <small>{field.hint}</small> : null}
          </label>
        ))}
        <footer>
          <button type="button" className="rg-button rg-secondary" disabled={busy} onClick={onClose}>Kanselahin</button>
          <button type="submit" className="rg-button rg-primary" disabled={busy}>{busy ? "Sine-save…" : "I-save"}</button>
        </footer>
      </form>
    </Dialog>
  );
}

/** Top-bar bell: the things that need a person now (findings to verify, stopped jobs, an offline SMS phone). */
export function NotificationBell({ base }: { base: string }) {
  const { data } = useOperations();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const toVerify = data.surveys.filter((s) => s.status === "Needs review");
  const stopped = data.surveys.filter((s) => s.status === "Failed" || s.auto_status === "failed");
  const smsOffline = data.providers.sms === "offline";
  const items: Array<{ key: string; icon: ReactNode; text: string; detail: string; to: string }> = [
    ...toVerify.map((s) => ({ key: `v-${s.id}`, icon: <ClipboardCheck size={16} />, text: "I-verify ang nakita ng AI", detail: s.name, to: `${base}/review?survey=${s.id}` })),
    ...stopped.map((s) => ({ key: `f-${s.id}`, icon: <RotateCcw size={16} />, text: s.status === "Failed" ? "Huminto ang pagproseso" : "Hindi natapos ang automation",
      detail: s.name, to: `${base}/review?survey=${s.id}` })),
    ...(smsOffline ? [{ key: "sms", icon: <MessageSquare size={16} />, text: "Offline ang SMS phone", detail: "Buksan ang SMS Gate app sa phone", to: `${base}/settings#sms` }] : []),
  ];
  return (
    <div className="rg-bell" ref={root}>
      <button type="button" className="rg-icon-button" aria-expanded={open} aria-haspopup="true"
        aria-label={items.length ? `${items.length} kailangang gawin` : "Walang kailangang gawin"} onClick={() => setOpen(!open)}>
        <Bell size={18} />
        {items.length ? <span className="rg-bell-count" aria-hidden>{items.length > 9 ? "9+" : items.length}</span> : null}
      </button>
      {open ? (
        <div className="rg-bell-menu" role="menu">
          <strong>Kailangang gawin</strong>
          {items.length ? (
            <ul>
              {items.slice(0, 8).map((item) => (
                <li key={item.key}><Link role="menuitem" to={item.to} onClick={() => setOpen(false)}>
                  {item.icon}<span><b>{item.text}</b><small>{item.detail}</small></span></Link></li>
              ))}
            </ul>
          ) : <p>Wala. Lahat ng survey ay na-verify at gumagana ang SMS.</p>}
        </div>
      ) : null}
    </div>
  );
}

export type SmsHealth = {
  state: "connected" | "offline" | "credentials_present" | "configuration_required" | "error";
  checked_at: string; cloud_last_seen: string | null; last_webhook_at: string | null; last_webhook_kind: string | null;
  last_failure_reason: string | null; last_failure_at: string | null; device_name: string | null;
};

export const ago = (iso: string | null | undefined) => {
  if (!iso) return "wala pa";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "ngayon lang";
  if (minutes < 60) return `${minutes} min ang nakalipas`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} oras ang nakalipas` : new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
};

/** Live SMS phone status: re-checked every 30 s while the card is on screen. */
export function SmsGatewayCard() {
  const { operation, demo } = useOperations();
  const [health, setHealth] = useState<SmsHealth | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ping, setPing] = useState("");
  useEffect(() => {
    if (demo) return;
    let active = true;
    const check = () => operation("sms-gateway-health").then((result: SmsHealth) => { if (active) { setHealth(result); setError(""); } })
      .catch((e: Error) => { if (active) setError(e.message); });
    void check();
    const timer = window.setInterval(check, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [operation, demo]);
  const online = health?.state === "connected";
  const latest = [health?.cloud_last_seen, health?.last_webhook_at].filter(Boolean).sort().pop() || null;
  const noLoad = health?.last_failure_reason && /load|balance|credit|insufficient|RESULT_ERROR_GENERIC_FAILURE|generic/i.test(health.last_failure_reason);
  const registerPing = async () => {
    setBusy(true);
    try {
      const result = await operation("sms-gateway-register-ping") as { existing?: boolean };
      setPing(result.existing ? "Naka-set na ang heartbeat." : "Naka-set na ang heartbeat. Buksan sa app: Settings → Ping, at maglagay ng interval (hal. 300 segundo).");
    } catch (e) { setPing((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="rg-panel rg-sms-health" id="sms" aria-live="polite">
      <header>
        <h2>Android SMS Gate</h2>
        <span className={`rg-pill ${online ? "is-good" : health ? "is-bad" : ""}`}><i />{demo ? "demo" : !health ? "sinusuri…" : online ? "Online" : "Offline"}</span>
      </header>
      {error ? <p role="alert" className="rg-inline-error"><CircleAlert size={15} /> {error}</p> : null}
      <dl className="rg-facts">
        <div><dt>Huling signal mula sa phone</dt><dd>{ago(latest)}</dd></div>
        <div><dt>Huling ulat ng SMS</dt><dd>{health?.last_webhook_kind ? `${health.last_webhook_kind.replace("sms:", "")} · ${ago(health.last_webhook_at)}` : "wala pa"}</dd></div>
        <div><dt>Huling bigong padala</dt><dd>{health?.last_failure_reason ? `${noLoad ? "Walang load ang SIM? " : ""}${health.last_failure_reason} · ${ago(health.last_failure_at)}` : "wala"}</dd></div>
        <div><dt>Phone</dt><dd>{health?.device_name || "—"}</dd></div>
      </dl>
      <details className="rg-howto">
        <summary>Paano malalaman kung online?</summary>
        <ol>
          <li>“Online” kapag may signal mula sa phone sa loob ng 15 minuto: ang SMS Gate cloud (huling kontak ng app) o isang ulat/heartbeat na ipinadala mismo ng phone.</li>
          <li>Sa phone: bukas ang SMS Gate app, naka-on ang <b>Cloud server</b>, may internet, at hindi pinapatay ng battery saver ang app.</li>
          <li>Para sa tuloy-tuloy na status, i-on ang heartbeat (button sa ibaba) at sa app: Settings → Ping, interval 300 s.</li>
          <li>Ang “online” ay hindi nangangahulugang may load ang SIM. Kapag “failed” ang huling padala, i-check ang load o promo ng SIM.</li>
        </ol>
        {!demo ? <button type="button" className="rg-button rg-secondary" disabled={busy} onClick={() => void registerPing()}>I-on ang heartbeat</button> : null}
        {ping ? <p className="rg-muted">{ping}</p> : null}
      </details>
    </section>
  );
}
