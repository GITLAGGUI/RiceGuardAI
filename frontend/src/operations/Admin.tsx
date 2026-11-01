import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { inferenceConfigurationLabel, type InferenceConfiguration } from "../../../supabase/functions/_shared/systemReadiness";
import {
  Link,
  NavLink,
  Outlet,
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  LayoutDashboard,
  Map,
  ScanLine,
  ClipboardCheck,
  Users,
  MessageSquare,
  Settings,
  ExternalLink,
  Pencil,
  Trash2,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Search,
  MapPin,
  Clock,
  CircleAlert,
  ChevronRight,
  Menu,
  X,
  RefreshCw,
  FileImage,
  Radio,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";
import { Brand } from "./Public";
import { fieldSeverityForSurvey, fieldSeverityLabel } from "./severityPresentation";
import { FieldMap } from "./Map";
import { OperationsProvider, operation, useOperations } from "./store";
import { useAuth } from "@/context/AuthContext";
import {
  normalizePhone,
  type Contact,
  type OperationsData,
  type Survey,
} from "./domain";
import { UploadWorkspace } from "./Upload";
import { VerifyWorkspace } from "./VerifyFindings";
import { LivePipeline, duration } from "./PipelineMonitor";
import { ConfirmDialog, EditDialog, NotificationBell, SmsGatewayCard } from "./WorkspaceUi";
import { supabase } from "@/lib/supabase";
import { reviewedDiseaseLabel, advisoryActionSteps } from "./advisoryPresentation";
import { reviewHref } from "./ReviewJourney";
import { SmsDelivery } from "./SmsDelivery";
import "./operations.css";
import "./workspace.css";

const nav = [
  ["overview", "Overview", LayoutDashboard],
  ["surveys", "Drone surveys", ScanLine],
  ["map", "Operations map", Map],
  ["review", "Verify findings", ClipboardCheck],
  ["advisories", "Advisory desk", FileImage],
  ["farmers", "Farmers & fields", Users],
  ["sms", "SMS delivery", MessageSquare],
  ["settings", "Settings", Settings],
] as const;
/** The signed-in person's name, else the part of their email before the @. */
export function displayName(fullName?: string | null, email?: string | null) {
  return fullName?.trim() || (email ? email.split("@")[0] : "") || "Staff member";
}
export function OperationsRoot({ demo = false, fixture }: { demo?: boolean; fixture?: OperationsData }) {
  return (
    <OperationsProvider demo={demo} fixture={fixture}>
      <OperationsShell />
    </OperationsProvider>
  );
}
export function useBase() {
  return useOperations().demo ? "/demo" : "/admin";
}
function OperationsShell() {
  const { demo, error, refresh, loading } = useOperations();
  const { profile, user, signOut } = useAuth();
  const base = useBase();
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const items = [
      ...document.querySelectorAll<HTMLElement>(
        ".rg-sidebar a, .rg-sidebar button",
      ),
    ];
    items[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
      if (e.key === "Tab") {
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document
        .querySelector<HTMLElement>('[aria-label="Open navigation"]')
        ?.focus();
    };
  }, [menu]);
  return (
    <div className="rg-ops">
      <a className="rg-skip" href="#main">
        Skip to workspace
      </a>
      <aside className={`rg-sidebar ${menu ? "open" : ""}`}>
        <div className="rg-sidebar-brand">
          <Brand light />
          <button
            className="rg-mobile-menu rg-icon-button"
            onClick={() => setMenu(false)}
            aria-label="Close sidebar"
          >
            <X />
          </button>
        </div>
        <div className="rg-workspace-label">
          Field operations <span>Region II</span>
        </div>
        <nav aria-label="Operations navigation">
          {nav.map(([url, label, Icon]) => (
            <NavLink
              onClick={() => setMenu(false)}
              key={url}
              to={`${base}/${url}`}
            >
              <Icon size={19} />
              <span>{label}</span>
              {url === "review" && <span className="rg-nav-dot" />}
            </NavLink>
          ))}
        </nav>
        <div className="rg-sidebar-bottom">
          <div className="rg-pilot">
            <Radio size={17} />
            <strong>RiceGuard pilot</strong>
            <p>One region. A more informed farming community.</p>
            <Link to="/bulletin">
              Open public bulletin <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="rg-user">
            <span className="rg-avatar">
              {(demo ? "Demo operator" : displayName(profile?.full_name, user?.email))[0]}
            </span>
            <Link to={`${base}/settings#profile`} onClick={() => setMenu(false)} aria-label="Buksan ang iyong profile">
              <strong>
                {demo ? "Demo operator" : displayName(profile?.full_name, user?.email)}
              </strong>
              <small>
                {demo ? "Isolated preview" : profile?.role === "admin" ? "Administrator" : "Authenticated workspace"}
              </small>
            </Link>
            {!demo && (
              <button
                className="rg-icon-button"
                aria-label="Sign out"
                onClick={() => void signOut()}
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="rg-menu-backdrop"
          aria-label="Close menu"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="rg-ops-main" inert={menu}>
        <header className="rg-ops-top">
          <div>
            <button
              className="rg-mobile-menu rg-icon-button"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={22} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>Region II</strong>
          </div>
          <div>
            <span className={`rg-environment ${demo ? "demo" : ""}`}>
              {demo ? "Demo · walang padala" : "Live workspace"}
            </span>
            <button
              className="rg-icon-button"
              aria-label="Refresh workspace"
              disabled={loading}
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} />
            </button>
            <NotificationBell base={base} />
          </div>
        </header>
        <main id="main" className="rg-workspace">
          {error && (
            <div className="rg-notice rg-warning" role="alert">
              <CircleAlert size={18} />
              <span>
                {error} Live data has not been replaced with sample data.
              </span>
            </div>
          )}
          {demo && (
            <div className="rg-demo-ribbon">
              <span>Design preview</span> Sample surveys and contacts. Uploads
              do not run inference; messages are never sent.
            </div>
          )}
          <Outlet />
        </main>
        <nav className="rg-admin-bottom" aria-label="Mobile quick navigation">
          {nav.slice(0, 4).map(([url, label, Icon]) => (
            <NavLink key={url} to={`${base}/${url}`}>
              <Icon size={19} />
              <span>
                {label
                  .replace("Drone ", "")
                  .replace("Operations ", "")
                  .replace("Detection ", "")}
              </span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
export function PageHeading({
  eyebrow = "REGION II FIELD OPERATIONS",
  title,
  text,
  action,
}: {
  eyebrow?: string;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="rg-page-heading">
      <div>
        <div className="rg-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`rg-status ${value.toLowerCase().replaceAll(" ", "-")}`}>
      <i />
      {value}
    </span>
  );
}
function SurveyList({
  surveys,
  compact = false,
}: {
  surveys: Survey[];
  compact?: boolean;
}) {
  const base = useBase();
  const { data } = useOperations();
  const verifiedUploads = (surveyId: string) =>
    data.assets.filter((asset) => asset.survey_id === surveyId && asset.status === "Verified").length;
  return (
    <div className={compact ? "rg-queue-list" : "rg-survey-table"}>
      {!compact && (
        <div className="rg-table-head">
          <span>Survey / location</span>
          <span>Photos</span>
          <span>Processing</span>
          <span>Severity</span>
          <span />
        </div>
      )}
      {surveys.map(s => ({ ...s, severity: fieldSeverityForSurvey(s, data.bulletins) })).map((s) => (
        <Link
          key={s.id}
          to={`${base}/review?survey=${s.id}`}
          className="rg-survey-row"
        >
          <span className="rg-row-main">
            <span className={`rg-survey-icon ${s.severity}`}>
              <ScanLine size={20} />
            </span>
            <span>
              <strong>{s.name}</strong>
              <small>
                <MapPin size={12} />
                {s.location}
              </small>
            </span>
          </span>
          {!compact && (
            <span className="rg-photo-count">
              {s.photos} <small>photos</small>
            </span>
          )}
          <span className="rg-survey-progress-cell">
            <Status value={s.status} />
            {!compact && s.status === "Awaiting upload" ? (
              <small className="rg-upload-count">{verifiedUploads(s.id)} / {s.expected_assets || s.photos} originals verified</small>
            ) : null}
            {!compact && <SurveyTimeline status={s.status} progress={s.progress || 0} />}
          </span>
          {!compact && (
            <span className={`rg-severity ${s.severity}`}>{fieldSeverityLabel(s.severity)}</span>
          )}
          <ChevronRight size={16} />
        </Link>
      ))}
    </div>
  );
}
const workflowStates = [
  ["Upload", ["Awaiting upload"]],
  ["Checks", ["Validating"]],
  ["Queue", ["Queued", "Submitting", "Waiting for GPU"]],
  ["Inference", ["Running", "Validating results"]],
  ["Review", ["Needs review"]],
  ["Approved", ["Reviewed"]],
] as const;
function SurveyTimeline({ status, progress }: { status: Survey["status"]; progress: number }) {
  const active = workflowStates.findIndex(([, states]) => (states as readonly string[]).includes(status));
  return (
    <span className="rg-mini-timeline" aria-label={`Workflow stage ${status}; ${progress}% complete`}>
      {workflowStates.map(([label], index) => <i key={label} className={index < active ? "done" : index === active ? "active" : ""} title={label} />)}
    </span>
  );
}
export function OverviewPage() {
  const { data, demo } = useOperations();
  const base = useBase();
  const toVerify = data.surveys.filter((s) => s.status === "Needs review");
  const processing = data.surveys.filter((s) => ["Queued", "Submitting", "Waiting for GPU", "Running", "Validating results"].includes(s.status));
  const stopped = data.surveys.filter((s) => s.status === "Failed" || s.auto_status === "failed");
  const published = data.bulletins.filter((b) => b.status === "published" && b.verification_status !== "retracted");
  const reachable = data.contacts.filter((c) => c.consent && c.verified).length;
  const finding = stopped.length
    ? `${stopped.length} survey ang huminto; buksan para ulitin.`
    : toVerify.length
      ? `${toVerify.length} survey ang naka-post na pero hindi pa na-verify ng specialist.`
      : processing.length
        ? `${processing.length} survey ang pinoproseso ngayon.`
        : "Walang naghihintay. Lahat ng survey ay na-verify.";
  const smsLabel: Record<string, [string, string]> = {
    connected: ["Online", "is-good"], offline: ["Offline", "is-bad"], error: ["Error", "is-bad"],
    credentials_present: ["Naka-configure", "is-warn"], configuration_required: ["Hindi naka-configure", "is-warn"],
  };
  const services: Array<[string, string, string]> = [
    ["SMS phone", ...(smsLabel[data.providers.sms] || [data.providers.sms, ""])] as [string, string, string],
    ["Kaggle GPU", data.providers.kaggle === "connected" ? "Handa" : data.providers.kaggle.replaceAll("_", " "), data.providers.kaggle === "connected" ? "is-good" : "is-warn"],
    ["Private Drive", data.providers.drive === "connected" ? "Handa" : data.providers.drive.replaceAll("_", " "), data.providers.drive === "connected" ? "is-good" : "is-warn"],
    ["AI na payo", data.providers.advisory === "connected" ? "Handa" : data.providers.advisory.replaceAll("_", " "), data.providers.advisory === "connected" ? "is-good" : "is-warn"],
  ];
  return (
    <>
      <PageHeading
        title="Region II overview"
        text={finding}
        action={<Link className="rg-button rg-primary" to={`${base}/surveys/new`}><Plus size={18} /> Bagong survey</Link>}
      />
      <section className="rg-panel rg-kpis" aria-label="Mga bilang">
        <Link to={`${base}/review`} className={toVerify.length ? "is-alert" : ""}><span>I-verify</span><strong>{toVerify.length}</strong><small>naka-post, hinihintay ang specialist</small></Link>
        <Link to={`${base}/surveys`}><span>Pinoproseso</span><strong>{processing.length}</strong><small>sa pila o nasa GPU</small></Link>
        <Link to={`${base}/advisories`}><span>Naka-post na payo</span><strong>{published.length}</strong><small>{published.filter((b) => b.verification_status === "unverified").length} hindi pa verified</small></Link>
        <Link to={`${base}/farmers`}><span>Maaabot sa SMS</span><strong>{reachable}</strong><small>verified at pumayag, sa {data.contacts.length} contact</small></Link>
      </section>
      <div className="rg-overview-grid">
        <div>
          <LivePipeline />
          <section className="rg-panel rg-map-panel">
            <div className="rg-section-head"><h2>Mapa ng mga survey</h2><Link to={`${base}/map`}>Buksan ang mapa</Link></div>
            <FieldMap
              points={data.surveys
                .filter((s) => s.lat != null && s.lng != null)
                .map((s) => ({ ...s, severity: fieldSeverityForSurvey(s, data.bulletins), lat: s.lat!, lng: s.lng! }))}
              onSelect={(id) => { window.location.hash = id; }}
            />
            <div className="rg-panel-footer">
              <span><span className="rg-dot" />{data.surveys.filter((s) => s.lat != null).length} survey na may lokasyon</span>
              <small>{demo ? "Halimbawang lokasyon" : "Pribadong mapa ng operator"}</small>
            </div>
          </section>
        </div>
        <div className="rg-overview-side">
          <section className="rg-panel">
            <div className="rg-section-head"><h2>Kailangang gawin</h2><Link to={`${base}/review`}>Lahat</Link></div>
            {[...stopped, ...toVerify].length ? (
              <ul className="rg-todo">
                {[...stopped, ...toVerify.filter((s) => !stopped.includes(s))].slice(0, 6).map((s) => {
                  const failed = stopped.includes(s);
                  return (
                    <li key={s.id}><Link to={`${base}/review?survey=${s.id}`}>
                      <b>{s.name.split(" · ")[0]}</b>
                      <small>{failed ? s.auto_error || "Huminto ang pagproseso" : s.name.split(" · ")[1] || s.location}</small>
                      <span className={`rg-pill ${failed ? "is-bad" : "is-warn"}`}><i />{failed ? "Ulitin" : "I-verify"}</span>
                    </Link></li>
                  );
                })}
              </ul>
            ) : <p className="rg-todo-empty">Walang naghihintay ng aksyon.</p>}
          </section>
          <section className="rg-panel">
            <div className="rg-section-head"><h2>Mga serbisyo</h2><Link to={`${base}/settings#system`}>Detalye</Link></div>
            <ul className="rg-services">
              {services.map(([label, value, tone]) => <li key={label}><span>{label}</span><span className={`rg-pill ${tone}`}><i />{value}</span></li>)}
            </ul>
          </section>
          <section className="rg-panel">
            <div className="rg-section-head"><h2>Huling mga survey</h2><Link to={`${base}/surveys`}>Lahat</Link></div>
            <SurveyList surveys={data.surveys.slice(0, 4)} compact />
          </section>
        </div>
      </div>
    </>
  );
}

function SurveyActions({ survey }: { survey: Survey }) {
  const { operation, refresh, demo } = useOperations();
  const [mode, setMode] = useState<"" | "edit" | "delete">("");
  const [busy, setBusy] = useState(false);
  const run = async (action: string, payload: Record<string, unknown>, done: string) => {
    setBusy(true);
    try { await operation(action, { id: survey.id, ...payload }); await refresh(); toast.success(done); setMode(""); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <span className="rg-row-actions">
      <button type="button" className="rg-icon-button" aria-label={`I-edit ${survey.name}`} disabled={demo} onClick={() => setMode("edit")}><Pencil size={16} /></button>
      <button type="button" className="rg-icon-button is-danger" aria-label={`Burahin ${survey.name}`} disabled={demo} onClick={() => setMode("delete")}><Trash2 size={16} /></button>
      <EditDialog open={mode === "edit"} title="I-edit ang survey" busy={busy} onClose={() => setMode("")}
        fields={[
          { name: "name", label: "Pangalan", value: survey.name, required: true, maxLength: 160 },
          { name: "note", label: "Tala", value: survey.note || "", multiline: true, maxLength: 1000, hint: "Para sa staff lamang; hindi lumalabas sa post." },
        ]}
        onSave={(values) => void run("update-survey", values, "Na-save ang survey.")} />
      <ConfirmDialog open={mode === "delete"} title="Burahin ang survey?" busy={busy} confirmLabel="Burahin" onClose={() => setMode("")}
        onConfirm={() => void run("archive-survey", { confirmed: true }, "Inalis ang survey sa workspace.")}
        body={<>
          <p><b>{survey.name}</b> ay aalisin sa workspace kasama ang mga draft nito at mga hindi pa naipadalang SMS.</p>
          <p>Kung may naka-post na payo, bawiin muna ito sa Advisory desk. Ang mga orihinal na larawan ay hindi binubura.</p>
        </>} />
    </span>
  );
}

export function SurveysPage() {
  const { data } = useOperations();
  const base = useBase();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const rows = data.surveys.filter((s) => (status === "all" || s.status === status) &&
    `${s.name} ${s.location} ${s.place?.label || ""}`.toLowerCase().includes(query.toLowerCase()));
  const states = [...new Set(data.surveys.map((s) => s.status))];
  return (
    <>
      <PageHeading
        title="Surveys"
        text="Bawat upload ng larawan: lugar, yugto ng pagproseso at severity. I-edit ang pangalan o tala, o burahin ang survey."
        action={<Link className="rg-button rg-primary" to={`${base}/surveys/new`}><Plus size={18} /> Bagong survey</Link>}
      />
      <div className="rg-toolbar">
        <label className="rg-search"><Search size={18} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Hanapin ang survey" placeholder="Hanapin ang survey o lugar" /></label>
        <select aria-label="Yugto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Lahat ng yugto</option>
          {states.map((s) => <option key={s}>{s}</option>)}
        </select>
        <span className="rg-count-note">{rows.length} sa {data.surveys.length}</span>
      </div>
      <section className="rg-panel rg-table-panel">
        {rows.length ? (
          <table className="rg-data-table">
            <thead><tr><th>Survey</th><th className="num">Larawan</th><th>Yugto</th><th>Severity</th><th>Petsa</th><th className="actions"><span className="sr-only">Aksyon</span></th></tr></thead>
            <tbody>
              {rows.map((s) => {
                const severity = fieldSeverityForSurvey(s, data.bulletins);
                return (
                  <tr key={s.id}>
                    <td><span className="rg-cell-main"><Link to={`${base}/review?survey=${s.id}`}>{s.name.split(" · ")[0]}</Link><small>{s.place?.label || s.location}</small></span></td>
                    <td className="num" data-label="Larawan">{s.photos}</td>
                    <td data-label="Yugto"><Status value={s.status} /></td>
                    <td data-label="Severity"><span className={`rg-severity ${severity}`}>{fieldSeverityLabel(severity)}</span></td>
                    <td data-label="Petsa">{new Date(s.created_at || s.captured_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</td>
                    <td className="actions"><SurveyActions survey={s} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="rg-todo-empty">Walang survey na tugma sa paghahanap.</p>}
      </section>
    </>
  );
}

export function MapPage() {
  const { data } = useOperations();
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const base = useBase();
  const located = data.surveys.map((item) => ({ ...item, severity: fieldSeverityForSurvey(item, data.bulletins) }));
  const points = located.filter((item) => item.lat != null && item.lng != null &&
    (filter === "all" || item.severity === filter || (filter === "not_calibrated" && item.severity === "unknown")))
    .map((item) => ({ ...item, lat: item.lat!, lng: item.lng! }));
  const missing = data.surveys.filter((item) => item.lat == null || item.lng == null).length;
  return (
    <>
      <PageHeading title="Operations map"
        text={`Pribadong lokasyon ng ${points.length} survey${missing ? `; ${missing} ang walang GPS at wala sa mapa` : ""}. Ang kulay ay severity na na-review, hindi confidence ng AI.`} />
      <div className="rg-toolbar">
        <select aria-label="Severity" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Lahat ng severity</option>
          {["low", "moderate", "high", "not_calibrated"].map((x) => <option key={x} value={x}>{fieldSeverityLabel(x as Survey["severity"])}</option>)}
        </select>
        <span className="rg-count-note">{points.length} pin</span>
      </div>
      <div className="rg-map-layout">
        <div className="rg-map-stage"><FieldMap large points={points} onSelect={setSelected} focusId={selected || undefined} /></div>
        <section className="rg-panel rg-map-side" aria-label="Mga survey sa mapa">
          <div className="rg-section-head"><h2>Mga survey</h2></div>
          <ul className="rg-map-items">
            {located.map((item) => {
              const advisory = data.bulletins.find((b) => b.survey_id === item.id && b.result_revision === item.active_result_revision);
              const pinned = item.lat != null && item.lng != null;
              return (
                <li key={item.id} className={selected === item.id ? "is-selected" : ""}>
                  <button type="button" disabled={!pinned} onClick={() => setSelected(item.id)}>
                    <b>{item.name.split(" · ")[0]}</b>
                    <small>{item.place?.label || item.location}</small>
                    <span className="rg-map-tags">
                      <span className={`rg-severity ${item.severity}`}>{fieldSeverityLabel(item.severity)}</span>
                      <span className={`rg-pill ${advisory?.status === "published" ? "is-good" : ""}`}><i />{advisory?.status === "published" ? "Naka-post" : "Hindi naka-post"}</span>
                      {!pinned ? <span className="rg-pill is-warn"><i />Walang GPS</span> : null}
                    </span>
                  </button>
                  <Link to={`${base}/review?survey=${item.id}`} aria-label={`Buksan ang ${item.name}`}><ArrowRight size={16} /></Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}
export function AdvisoryDesk() {
  const { data, demo, refresh } = useOperations();
  const [params, setParams] = useSearchParams();
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const requested = params.get("advisory");
  const surveyId = params.get("survey");
  const b = requested ? data.bulletins.find((item) => item.id === requested && (!surveyId || item.survey_id === surveyId))
    : surveyId ? data.bulletins.find((item) => item.survey_id === surveyId) : data.bulletins[0];
  const list = data.bulletins.filter((item) => `${item.title} ${item.location}`.toLowerCase().includes(query.toLowerCase()));
  const verification: Record<string, string> = { unverified: "Hindi pa verified", verified: "Verified", corrected: "Inayos ng specialist", retracted: "Binawi" };
  return (
    <>
      <PageHeading title="Advisory desk" text="Lahat ng payo: draft, naka-post at binawi. Pumili ng isa para basahin, i-edit sa guided review, o bawiin." />
      <div className="rg-desk-grid rg-desk-guided">
        <aside className="rg-panel rg-draft-list" aria-label="Mga payo">
          <label className="rg-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hanapin ang payo" aria-label="Hanapin ang payo" /></label>
          {list.map((item) => (
            <button key={item.id} className={b?.id === item.id ? "selected" : ""}
              onClick={() => { setParams({ advisory: item.id, ...(item.survey_id ? { survey: item.survey_id } : {}) }); setDeleting(false); }}>
              <span className="rg-badge">{reviewedDiseaseLabel(item)}</span>
              <strong>{item.title.replace("Rice Field Health Advisory — ", "")}</strong>
              <small>{item.location} · {item.date || (item.published_at || "").slice(0, 10)}</small>
              <Status value={item.status} />
            </button>
          ))}
          {!list.length ? <p className="rg-todo-empty">Walang tugmang payo.</p> : null}
        </aside>
        {b ? (
          <section className="rg-panel rg-advisory-view">
            <div className="rg-advisory-main">
              <h2>{b.title}</h2>
              <div className="rg-advisory-meta">
                <Status value={b.status} />
                {b.auto_generated ? <span className={`rg-pill ${b.verification_status === "unverified" ? "is-warn" : b.verification_status === "retracted" ? "is-bad" : "is-good"}`}><i />{verification[b.verification_status || "unverified"]}</span> : null}
                <span>{b.place?.label || b.location}</span>
              </div>
              {b.image ? <img src={b.image} alt={`Larawan para sa ${b.title}`} /> : null}
              <p>{b.body}</p>
              <h3>Mga dapat gawin</h3>
              <ol>{advisoryActionSteps(b.action).map((text, i) => <li key={i}>{text.replace(/^\d+\.\s*/, "")}</li>)}</ol>
              {b.limitations ? <p className="rg-muted">{b.limitations}</p> : null}
            </div>
            <aside>
              <p>{b.status === "published" ? "Naka-post. Ang pagbabago ay dumadaan sa correction para may tala." : "Draft. Walang public post o SMS hangga't hindi naaprubahan."}</p>
              {b.survey_id ? <Link className="rg-button rg-primary" to={reviewHref(b.survey_id, b.id, b.status === "published" ? "publish" : "images")}>
                <Pencil size={16} /> {b.status === "published" ? "I-edit / gumawa ng correction" : "Ituloy ang review"}</Link>
                : <p role="alert">Walang survey ang payong ito; hindi ito maipo-post.</p>}
              {b.status === "published" ? <Link className="rg-button rg-secondary" to={`/advisories/${b.slug}`} target="_blank"><ExternalLink size={16} /> Tingnan ang post</Link> : null}
              {b.survey_id ? <Link className="rg-button rg-secondary" to={`${useBaseStatic(demo)}/review?survey=${b.survey_id}`}><ClipboardCheck size={16} /> Specialist check</Link> : null}
              {!demo ? <button type="button" className="rg-button rg-secondary rg-danger-text" onClick={() => setDeleting(true)}><Trash2 size={16} /> Bawiin / burahin</button> : null}
            </aside>
            <ConfirmDialog open={deleting} title="Bawiin ang payo?" busy={busy} confirmLabel="Bawiin" onClose={() => setDeleting(false)}
              onConfirm={async () => {
                setBusy(true);
                try { await operation("archive-advisory", { id: b.id, advisory_revision: b.advisory_revision, confirmed: true }); setDeleting(false); await refresh(); toast.success("Binawi ang payo; nanatili ang orihinal na larawan."); }
                catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
              }}
              body={<>
                <p><b>{b.title}</b> ay aalisin sa public bulletin at mapa, at hindi na ipapadala ang mga naka-queue na SMS.</p>
                <p>Maaaring ibalik: naka-archive ito, hindi binura. Ang mga orihinal na larawan ng survey ay hindi ginagalaw.</p>
              </>} />
          </section>
        ) : <div role="alert" className="rg-empty">{requested || surveyId ? "Hindi makita ang payong ito." : "Wala pang payo. Matatapos ito pagkatapos ng unang survey."}</div>}
      </div>
      <section id="guidance-library"><GuidanceSourceReview demo={demo} selectedSourceIds={b?.advisory_source_ids || []} /></section>
    </>
  );
}
const useBaseStatic = (demo: boolean) => (demo ? "/demo" : "/admin");

type GuidanceCandidate = {
  id: string;
  disease: string;
  title: string;
  publisher: string;
  version: string;
  reference: string;
  guidance: {
    summary: string;
    recommended_actions: string[];
    limitations: string[];
  };
};
type ApprovedGuidance = {
  id: string;
  disease: string;
  title: string;
  version: string;
  source_reference: string;
  active: boolean;
  approved_at: string;
};

function GuidanceSourceReview({ demo, selectedSourceIds }: { demo: boolean; selectedSourceIds: string[] }) {
  const [candidates, setCandidates] = useState<GuidanceCandidate[]>([]);
  const [approved, setApproved] = useState<ApprovedGuidance[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [specialistName, setSpecialistName] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewingId, setReviewingId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setSourcesLoaded(false);
    const result = await operation("advisory-guidance") as {
      candidates: GuidanceCandidate[];
      approved: ApprovedGuidance[];
    };
    setCandidates(result.candidates);
    setApproved(result.approved);
    setSourcesLoaded(true);
  };
  useEffect(() => {
    if (demo) return;
    void load().catch((e: Error) => setError(e.message));
  }, [demo]);
  const approve = async (candidate: GuidanceCandidate) => {
    setBusy(true);
    setError("");
    try {
      await operation("approve-advisory-source", {
        candidate_id: candidate.id,
        specialist_name: specialistName.trim(),
        review_note: reviewNote.trim(),
        confirmed,
      });
      await load();
      setConfirmed(false);
      setReviewNote("");
      setReviewingId("");
      toast.success("Specialist-reviewed guidance recorded with an audit event.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rg-panel rg-guidance-review">
      <div className="rg-panel-heading">
        <h2>Agricultural guidance review</h2>
      </div>
      <p>AI drafts require active, specialist-reviewed guidance for every accepted disease. These references are candidates, not approved advice. Review the original source and wording before approval.</p>
      {!demo && <div className="rg-guidance-candidate"><h3>Sources attached to the selected draft</h3>
        {!sourcesLoaded && !error && <p role="status">Loading agricultural references…</p>}
        {selectedSourceIds.length ? <ul>{approved.filter((source) => selectedSourceIds.includes(source.id) && source.active && source.source_reference.startsWith("https://")).map((source) => <li key={source.id}><a href={source.source_reference} target="_blank" rel="noopener noreferrer">{source.title}</a> ({source.disease}, {source.version})</li>)}</ul> : <p>None attached. A new dual-disease result cannot be published without approved guidance for each accepted disease.</p>}
        {sourcesLoaded && selectedSourceIds.some((id) => !approved.some((source) => source.id === id && source.active)) && <p role="alert" className="rg-guidance-error">A cited source is missing or inactive. Regenerate and review the draft before publication.</p>}
      </div>}
      {demo && <p>Source approval is unavailable in the demo.</p>}
      {error && <p role="alert" className="rg-guidance-error">{error}</p>}
      {!demo && candidates.map((candidate) => {
        const isApproved = approved.some((source) => source.active && source.version === candidate.version && source.disease === candidate.disease);
        return (
          <article key={candidate.id} className="rg-guidance-candidate">
            <h3>{candidate.disease}: {candidate.title}</h3>
            <p>{candidate.publisher} · {isApproved ? "Approved for draft grounding" : "Awaiting specialist review"}</p>
            <p><a href={candidate.reference} target="_blank" rel="noopener noreferrer">Read original agricultural source</a></p>
            <p>{candidate.guidance.summary}</p>
            <ul>{candidate.guidance.recommended_actions.map((item) => <li key={item}>{item}</li>)}</ul>
            <ul>{candidate.guidance.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
            {!isApproved && reviewingId !== candidate.id && (
              <button className="rg-button rg-secondary" onClick={() => {
                setReviewingId(candidate.id);
                setReviewNote("");
                setConfirmed(false);
              }}>Review this candidate</button>
            )}
            {!isApproved && reviewingId === candidate.id && (
              <div className="rg-guidance-approval">
                <label>Reviewing agricultural specialist
                  <input value={specialistName} onChange={(e) => setSpecialistName(e.target.value)} maxLength={120} />
                </label>
                <label>Specific review note
                  <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} maxLength={500} />
                </label>
                <label className="rg-check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I checked the source and wording with the named specialist.</label>
                <button className="rg-button rg-primary" disabled={busy || !confirmed || specialistName.trim().length < 2 || reviewNote.trim().length < 10} onClick={() => void approve(candidate)}>Record reviewed guidance</button>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
const tint = (seed: string) => {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return { background: `hsl(${hash} 45% 90%)`, color: `hsl(${hash} 45% 24%)` };
};

function ContactActions({ contact }: { contact: Contact }) {
  const { operation, refresh, demo } = useOperations();
  const [mode, setMode] = useState<"" | "edit" | "delete">("");
  const [busy, setBusy] = useState(false);
  const run = async (action: string, payload: Record<string, unknown>, done: (result: Record<string, unknown>) => string) => {
    setBusy(true);
    try { const result = await operation(action, { id: contact.id, ...payload }); await refresh(); toast.success(done(result || {})); setMode(""); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <span className="rg-row-actions">
      <button type="button" className="rg-icon-button" aria-label={`I-edit si ${contact.name}`} disabled={demo} onClick={() => setMode("edit")}><Pencil size={16} /></button>
      <button type="button" className="rg-icon-button is-danger" aria-label={`Burahin si ${contact.name}`} disabled={demo} onClick={() => setMode("delete")}><Trash2 size={16} /></button>
      <EditDialog open={mode === "edit"} title="I-edit ang contact" busy={busy} onClose={() => setMode("")}
        fields={[
          { name: "name", label: "Pangalan ng magsasaka", value: contact.name, required: true, maxLength: 120 },
          { name: "phone", label: "Mobile number", value: contact.phone.replace(/^\+63/, "0"), required: true, inputMode: "tel",
            hint: "Kapag pinalitan ang numero, kailangang i-verify at pumayag muli bago padalhan ng SMS." },
          { name: "location", label: "Lugar", value: contact.location, maxLength: 240, placeholder: "Barangay, bayan, probinsya" },
        ]}
        onSave={(values) => {
          let phone = "";
          try { phone = normalizePhone(values.phone); } catch (e) { toast.error((e as Error).message); return; }
          void run("update-contact", { ...values, phone }, (r) => r.phone_changed ? "Na-save. Bagong numero: kailangang i-verify muli." : "Na-save ang contact.");
        }} />
      <ConfirmDialog open={mode === "delete"} title="Burahin ang contact?" busy={busy} confirmLabel="Burahin" onClose={() => setMode("")}
        onConfirm={() => void run("delete-contact", { confirmed: true }, (r) => r.anonymized
          ? "May naipadala nang SMS kaya tinanggal ang pangalan, pahintulot at bukid, pero nanatili ang tala ng padala."
          : "Nabura ang contact at ang mga bukid nito.")}
        body={<>
          <p><b>{contact.name}</b> ({contact.phone}) at ang {contact.farms.length} bukid nito ay aalisin. Hindi na siya padadalhan ng SMS.</p>
          <p>Kung napadalhan na siya dati, mananatili ang tala ng padala pero walang pangalan.</p>
        </>} />
    </span>
  );
}

export function FarmersPage() {
  const { data, demo, addContact } = useOperations();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    try {
      await addContact({ id: crypto.randomUUID(), name: String(f.get("name")).trim(), phone: normalizePhone(String(f.get("phone"))),
        location: String(f.get("location")).trim(), consent: false, verified: false, farms: [] });
      toast.success("Na-save nang walang SMS consent. I-verify ang numero at pahintulot bago padalhan.");
      form.reset();
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  const reachable = data.contacts.filter((c) => c.consent && c.verified).length;
  const pinned = data.contacts.filter((c) => c.farms.length).length;
  const rows = data.contacts.filter((c) => `${c.name} ${c.location} ${c.phone}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <PageHeading title="Farmers & fields" text="Ang mga magsasakang padadalhan ng SMS. Isang contact ay maaaring may ilang bukid; ang malapit ay hindi nangangahulugang may-ari." />
      <div className="rg-farmer-top">
        <section className="rg-panel rg-farmer-kpis" aria-label="Mga bilang">
          <div><span>Pilot contacts</span><strong>{data.contacts.length}</strong><small>sa 100 na limit</small></div>
          <div><span>Verified at pumayag</span><strong>{reachable}</strong><small>makakatanggap ng SMS</small></div>
          <div><span>May pin ng bukid</span><strong>{pinned}</strong><small>kasama sa 3 km na abiso</small></div>
        </section>
        <form className="rg-panel rg-contact-form" onSubmit={submit}>
          <h2>Magdagdag ng contact</h2>
          <div className="rg-form-row">
            <label>Pangalan<input name="name" required maxLength={120} autoComplete="off" /></label>
            <label>Mobile number<input name="phone" inputMode="tel" placeholder="09XXXXXXXXX" required /></label>
          </div>
          <label>Lugar<input name="location" required placeholder="Barangay, bayan, probinsya" /></label>
          <p>{demo ? "Halimbawang numero lang sa preview. " : ""}Hindi awtomatikong pumapayag ang bagong numero. Walang pin ng bukid = hindi kasama sa abiso ayon sa layo.</p>
          <button className="rg-button rg-primary" disabled={busy}><Plus size={16} /> {busy ? "Sine-save…" : "I-save ang contact"}</button>
        </form>
      </div>
      <div className="rg-toolbar">
        <label className="rg-search"><Search size={18} />
          <input placeholder="Hanapin ang pangalan, lugar o numero" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Hanapin ang magsasaka" /></label>
        <span className="rg-count-note">{rows.length} sa {data.contacts.length}</span>
      </div>
      <section className="rg-panel rg-table-panel">
        {rows.length ? (
          <table className="rg-data-table">
            <thead><tr><th>Magsasaka</th><th>Lugar</th><th>SMS</th><th className="num">Bukid</th><th className="actions"><span className="sr-only">Aksyon</span></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><span className="rg-person"><span className="rg-avatar" style={tint(c.id)}>{(c.name || "?")[0].toUpperCase()}</span>
                    <span className="rg-cell-main"><strong>{c.name}</strong><small>{c.phone}</small></span></span></td>
                  <td data-label="Lugar">{c.location}</td>
                  <td data-label="SMS">{c.consent && c.verified ? <span className="rg-pill is-good"><i />Maaabot</span>
                    : c.consent ? <span className="rg-pill is-warn"><i />Hindi pa verified</span>
                      : <span className="rg-pill"><i />Walang pahintulot</span>}</td>
                  <td className="num" data-label="Bukid">{c.farms.length}</td>
                  <td className="actions"><ContactActions contact={c} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="rg-todo-empty">Walang tugmang contact.</p>}
      </section>
    </>
  );
}

export function SmsPage() {
  return (
    <>
      <PageHeading
        title="SMS delivery"
        text="Gateway acceptance is not the same as a delivered message."
      />
      <SmsDelivery />
    </>
  );
}
const SETTINGS_SECTIONS = [
  ["profile", "Profile"],
  ["sms", "SMS at abiso"],
  ["system", "Pagproseso at modelo"],
  ["privacy", "Lokasyon at privacy"],
  ["audit", "Audit"],
] as const;

function ProfileSection() {
  const { profile, user, aal, signOut, refreshProfile } = useAuth();
  const { demo } = useOperations();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = demo ? "Demo operator" : displayName(profile?.full_name, user?.email);
  const save = async (values: Record<string, string>) => {
    if (!user) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("profiles").update({ full_name: values.full_name }).eq("id", user.id);
      if (error) throw new Error(error.message);
      await refreshProfile();
      toast.success("Na-save ang pangalan.");
      setEditing(false);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="rg-settings-section" id="profile">
      <header><h2>Profile</h2><p>Ang pangalang ito ang lumalabas sa sidebar at sa audit log ng mga pasya mo.</p></header>
      <div className="rg-panel rg-settings-card">
        <div className="rg-profile-card">
          <span className="rg-avatar">{name[0]}</span>
          <div><strong>{name}</strong><small>{demo ? "Isolated preview" : user?.email}</small></div>
          {!demo ? <button type="button" className="rg-button rg-secondary" onClick={() => setEditing(true)}><Pencil size={16} /> I-edit ang pangalan</button> : null}
        </div>
        <dl className="rg-settings-rows">
          <div><dt>Role</dt><dd>{demo ? "demo" : profile?.role === "admin" ? "Administrator (specialist at operator)" : profile?.role || "—"}</dd></div>
          <div><dt>Two-factor (MFA)</dt><dd>{demo ? "—" : aal === "aal2" ? "Naka-verify ngayong session" : "Hindi pa naka-verify ngayong session"}</dd></div>
          <div><dt>Account mula</dt><dd>{profile?.created_at ? new Date(profile.created_at).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }) : "—"}</dd></div>
        </dl>
        {!demo ? <button type="button" className="rg-button rg-secondary" style={{ justifySelf: "start" }} onClick={() => void signOut()}><LogOut size={16} /> Mag-sign out</button> : null}
      </div>
      <EditDialog open={editing} title="I-edit ang pangalan" busy={busy} onClose={() => setEditing(false)} onSave={(v) => void save(v)}
        fields={[{ name: "full_name", label: "Buong pangalan", value: profile?.full_name || "", required: true, maxLength: 120 }]} />
    </section>
  );
}

export function SettingsPage() {
  const { data, demo, reset, operation } = useOperations();
  const location = useLocation();
  const [active, setActive] = useState<string>("profile");
  const [configuration, setConfiguration] = useState<InferenceConfiguration | null>(null);
  const [configurationError, setConfigurationError] = useState("");
  useEffect(() => {
    if (demo) return;
    let alive = true;
    operation("system-readiness").then((result) => { if (alive) setConfiguration(result.inference); })
      .catch(() => { if (alive) setConfigurationError("Hindi ma-check ang server configuration ngayon."); });
    return () => { alive = false; };
  }, [operation, demo]);
  useEffect(() => {
    const id = location.hash.replace("#", "");
    if (id) window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
  }, [location.hash]);
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: "0px 0px -60% 0px" });
    SETTINGS_SECTIONS.forEach(([id]) => { const el = document.getElementById(id); if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);
  const activeModels = data.models.filter((model) => model.active);
  const jobs = data.jobs.filter((j) => j.started_at && j.completed_at).slice(0, 5);
  const label = (value: string) => value === "connected" ? "Handa" : value.replaceAll("_", " ");
  return (
    <>
      <PageHeading title="Settings" text="Ang iyong profile, ang SMS phone, ang pagproseso ng larawan at ang mga patakaran ng pilot, sa iisang lugar." />
      <div className="rg-settings">
        <nav className="rg-settings-nav" aria-label="Mga seksyon ng settings">
          {SETTINGS_SECTIONS.map(([id, text]) => <a key={id} href={`#${id}`} className={active === id ? "is-active" : ""}>{text}</a>)}
        </nav>
        <div className="rg-settings-body">
          <ProfileSection />
          <section className="rg-settings-section" id="sms-section">
            <header><h2>SMS at abiso</h2><p>Ang Android phone na nagpapadala ng SMS, at kung sino ang padadalhan.</p></header>
            <SmsGatewayCard />
            <div className="rg-panel rg-settings-card">
              <h3>Patakaran sa pagpapadala</h3>
              <dl className="rg-settings-rows">
                <div><dt>Padadalhan</dt><dd>Verified at pumayag na magsasaka na may bukid sa loob ng 3 km, o nakarehistro sa parehong barangay</dd></div>
                <div><dt>Quiet hours</dt><dd>20:00–06:00 (Asia/Manila); ipinapadala pagdating ng 6:00</dd></div>
                <div><dt>Limit bawat araw</dt><dd>2 payo bawat contact</dd></div>
                <div><dt>Pilot capacity</dt><dd>100 contact</dd></div>
                <div><dt>Pagpapadala</dt><dd>Awtomatiko pagka-post; may correction o pagbawi pagkatapos ng specialist check</dd></div>
              </dl>
            </div>
          </section>
          <section className="rg-settings-section" id="system">
            <header><h2>Pagproseso at modelo</h2><p>Paano sinusuri ang mga larawan, at kung handa ang bawat serbisyo. Configuration lang ito; ang patunay ay ang natapos na job.</p></header>
            <div className="rg-system-list">
              <article className="rg-panel"><h3>Kaggle GPU <span className={`rg-pill ${configuration?.dispatch_enabled ? "is-good" : "is-warn"}`}><i />{demo ? "demo" : inferenceConfigurationLabel(configuration)}</span></h3>
                <p>Tesla T4. BLB (U-Net ConvNeXt-B) at Brown Spot (YOLO26l), 1024 px na tile, stride 768.</p></article>
              <article className="rg-panel"><h3>AI na payo <span className={`rg-pill ${data.providers.advisory === "connected" ? "is-good" : "is-warn"}`}><i />{label(data.providers.advisory)}</span></h3>
                <p>Ollama Cloud, gamit lamang ang naaprubahang gabay ng specialist; may template kapag hindi sumagot.</p></article>
              <article className="rg-panel"><h3>Private Drive <span className={`rg-pill ${data.providers.drive === "connected" ? "is-good" : "is-warn"}`}><i />{label(data.providers.drive)}</span></h3>
                <p>Dito naka-imbak ang orihinal na larawan. Ang contact at pin ng bukid ay nasa protektadong database.</p></article>
            </div>
            <div className="rg-panel rg-settings-card">
              <h3>Pinned workflow</h3>
              <dl className="rg-settings-rows">
                <div><dt>Uploads · dispatch · callback</dt><dd>{configuration ? [configuration.upload_enabled, configuration.dispatch_enabled, configuration.callback_enabled].map((on) => on ? "on" : "off").join(" · ") : demo ? "—" : "sinusuri…"}</dd></div>
                <div><dt>Workflow SHA-256</dt><dd><code>{configuration?.workflow_sha256 || "—"}</code></dd></div>
                <div><dt>Dispatch</dt><dd>Agad pagkatapos ng upload; pg_cron bawat minuto bilang reserba</dd></div>
                <div><dt>Status ng Kaggle</dt><dd>Sinusuri bawat 2 minuto; ang naiwang “Submitting” ay ibinabalik sa pila</dd></div>
                <div><dt>Automation pagkatapos ng GPU</dt><dd>Agad; inuulit sa 15 s, 30 s, 1 min, 2 min at 4 min kapag pumalya</dd></div>
              </dl>
              {configurationError ? <p role="alert" className="rg-inline-error"><CircleAlert size={15} /> {configurationError}</p> : null}
            </div>
            {jobs.length ? (
              <div className="rg-panel rg-table-panel">
                <table className="rg-data-table">
                  <thead><tr><th>Huling mga job</th><th className="num">Pila</th><th className="num">GPU</th><th>Status</th></tr></thead>
                  <tbody>{jobs.map((job) => {
                    const survey = data.surveys.find((s) => s.id === job.survey_id);
                    const wait = job.started_at ? (Date.parse(job.started_at) - Date.parse(job.dispatched_at || job.created_at)) / 1000 : null;
                    const gpu = job.started_at && job.completed_at ? (Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000 : null;
                    return <tr key={job.id}><td><span className="rg-cell-main"><strong>{survey?.name.split(" · ")[0] || job.run_id}</strong><small>{new Date(job.created_at).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small></span></td>
                      <td className="num" data-label="Pila">{duration(wait)}</td><td className="num" data-label="GPU">{duration(gpu)}</td><td data-label="Status"><Status value={job.status} /></td></tr>;
                  })}</tbody>
                </table>
              </div>
            ) : null}
            {activeModels.length ? (
              <div className="rg-panel rg-settings-card">
                <h3>Optional adapter registry</h3>
                <dl className="rg-settings-rows">{activeModels.map((model) => <div key={model.id}><dt>{model.disease}</dt><dd>{model.version} · {model.architecture} · {model.input_size}px · threshold {model.threshold.toFixed(3)}</dd></div>)}</dl>
              </div>
            ) : null}
          </section>
          <section className="rg-settings-section" id="privacy">
            <header><h2>Lokasyon at privacy</h2><p>Region II lamang: Batanes, Cagayan, Isabela, Nueva Vizcaya at Quirino.</p></header>
            <div className="rg-panel rg-settings-card">
              <dl className="rg-settings-rows">
                <div><dt>Lokasyon ng survey</dt><dd>Median ng GPS ng mga larawan, o pin na inilagay ng staff</dd></div>
                <div><dt>Pangalan ng lugar</dt><dd>Barangay mula sa PSGC 2023 boundaries</dd></div>
                <div><dt>Public na mapa</dt><dd>Tinatayang lugar lamang (4 na decimal); walang larawang may EXIF o GPS</dd></div>
                <div><dt>Contact at bukid</dt><dd>Nakikita lamang ng admin na may MFA</dd></div>
              </dl>
            </div>
          </section>
          <section className="rg-settings-section" id="audit">
            <header><h2>Audit</h2><p>Bawat pasya ng specialist, post, pagbawi at pagbabago ng contact o survey ay naka-tala sa event log ng database.</p></header>
            <div className="rg-panel rg-settings-card">
              <p className="rg-muted" style={{ margin: 0 }}>{demo ? "Ang demo data ay nasa browser na ito lamang." : "Ang mga pagbura ng contact at survey ay may tala kung sino ang gumawa at kailan."}</p>
              {demo ? <button className="rg-button rg-secondary" style={{ justifySelf: "start" }} onClick={() => { if (confirm("I-reset ang demo data sa browser na ito?")) { reset(); toast.success("Na-reset ang demo."); } }}><RefreshCw size={16} /> I-reset ang demo</button> : null}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export function OperationsPage() {
  const location = useLocation();
  const page = location.pathname.split("/").slice(2).join("/");
  const navigate = useNavigate();
  if (page === "surveys/new") return <UploadWorkspace />;
  if (page === "review") return <VerifyWorkspace />;
  switch (page) {
    case "overview":
      return <OverviewPage />;
    case "surveys":
      return <SurveysPage />;
    case "map":
      return <MapPage />;
    case "advisories":
      return <AdvisoryDesk />;
    case "farmers":
      return <FarmersPage />;
    case "sms":
      return <SmsPage />;
    case "model":
      return <Navigate to="../settings#system" replace />;
    case "settings":
      return <SettingsPage />;
    default:
      return (
        <div className="rg-empty">
          <Clock />
          <h2>Workspace page not found</h2>
          <button
            className="rg-button rg-secondary"
            onClick={() => navigate("../overview")}
          >
            Back to overview
          </button>
        </div>
      );
  }
}
