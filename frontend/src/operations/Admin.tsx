import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  LayoutDashboard,
  Map,
  ScanLine,
  ClipboardCheck,
  Users,
  MessageSquare,
  Settings,
  Cpu,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Search,
  MapPin,
  Check,
  Clock,
  CircleAlert,
  ChevronRight,
  Menu,
  X,
  RefreshCw,
  FileImage,
  Radio,
  Bell,
  LogOut,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { Brand } from "./Public";
import { FieldMap } from "./Map";
import { OperationsProvider, useOperations } from "./store";
import { useAuth } from "@/context/AuthContext";
import {
  eligibleContacts,
  normalizePhone,
  smsSegments,
  type Survey,
} from "./domain";
import { UploadWorkspace, ReviewWorkspace } from "./Upload";
import "./operations.css";

const nav = [
  ["overview", "Overview", LayoutDashboard],
  ["surveys", "Drone surveys", ScanLine],
  ["map", "Operations map", Map],
  ["review", "Detection review", ClipboardCheck],
  ["advisories", "Advisory desk", FileImage],
  ["farmers", "Farmers & fields", Users],
  ["sms", "SMS delivery", MessageSquare],
  ["model", "Model & system", Cpu],
  ["settings", "Settings & audit", Settings],
] as const;
export function OperationsRoot({ demo = false }: { demo?: boolean }) {
  return (
    <OperationsProvider demo={demo}>
      <OperationsShell />
    </OperationsProvider>
  );
}
export function useBase() {
  return useOperations().demo ? "/demo" : "/admin";
}
function OperationsShell() {
  const { demo, error, refresh, loading } = useOperations();
  const { profile, signOut } = useAuth();
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
          FIELD OPERATIONS <span>REGION II</span>
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
              {demo ? "D" : (profile?.full_name || "S")[0]}
            </span>
            <div>
              <strong>
                {demo ? "Demo operator" : profile?.full_name || "Staff member"}
              </strong>
              <small>
                {demo ? "Isolated preview" : "Authenticated workspace"}
              </small>
            </div>
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
              {demo ? "DEMO · NO EXTERNAL SENDS" : "LIVE WORKSPACE"}
            </span>
            <button
              className="rg-icon-button"
              aria-label="Refresh workspace"
              disabled={loading}
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} />
            </button>
            <Link
              className="rg-icon-button"
              aria-label="Review backlog"
              to={`${base}/review`}
            >
              <Bell size={18} />
            </Link>
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
      {surveys.map((s) => (
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
            {!compact && <SurveyTimeline status={s.status} progress={s.progress || 0} />}
          </span>
          {!compact && (
            <span className={`rg-severity ${s.severity}`}>{s.severity}</span>
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
  const pending = data.surveys.filter((s) => s.status === "Needs review");
  const pendingJob = data.jobs.find((job) => pending.some((survey) => survey.id === job.survey_id));
  const pendingPreview = pendingJob?.review_urls
    ? Object.values(pendingJob.review_urls)[0]?.combined || Object.values(pendingJob.review_urls)[0]?.video
    : null;
  const stats = [
    {
      label: "Drone surveys",
      value: data.surveys.length,
      note: "Flight-based collections",
      icon: ScanLine,
    },
    {
      label: "Awaiting review",
      value: pending.length,
      note: "Before publication",
      icon: ClipboardCheck,
    },
    {
      label: "Published advisories",
      value: data.bulletins.filter((b) => b.status === "published").length,
      note: "Reviewed field information",
      icon: FileImage,
    },
    {
      label: "Verified SMS contacts",
      value: data.contacts.filter((c) => c.consent && c.verified).length,
      note: "Opted in and verified",
      icon: Users,
    },
  ];
  const workspaces = [
    { to: "surveys", title: "Surveys & uploads", detail: `${data.surveys.length} flight records · originals and progress`, icon: ScanLine },
    { to: "review", title: "Detection review", detail: `${pending.length} awaiting a decision`, icon: ClipboardCheck },
    { to: "advisories", title: "Advisory desk", detail: "Draft, approve, publish and correct", icon: FileImage },
    { to: "farmers", title: "Farmers & fields", detail: `${data.contacts.length} contact records and farm details`, icon: Users },
    { to: "sms", title: "SMS delivery", detail: "Recipients, outbox and delivery status", icon: MessageSquare },
    { to: "model", title: "Model & system", detail: "Checkpoints, thresholds and providers", icon: Cpu },
    { to: "settings", title: "Settings & audit", detail: "Configuration and activity history", icon: Settings },
  ];
  return (
    <>
      <PageHeading
        title="A clearer view of the field."
        text="Manage drone surveys, review findings, and keep nearby farmers informed."
        action={
          <Link className="rg-button rg-primary" to={`${base}/surveys/new`}>
            <Plus size={18} />
            New survey
          </Link>
        }
      />
      <div className="rg-stat-grid">
        {stats.map((s) => (
          <article className="rg-stat" key={s.label}>
            <div>
              <span>{s.label}</span>
              <s.icon size={18} />
            </div>
            <strong>{s.value.toString().padStart(2, "0")}</strong>
            <small>{s.note}</small>
          </article>
        ))}
      </div>
      <section className="rg-ops-hub" aria-labelledby="rg-ops-hub-title">
        <div className="rg-panel-heading">
          <div><h2 id="rg-ops-hub-title">Your workspace</h2><p>Open the next step directly. Counts reflect the current records, not sample figures.</p></div>
        </div>
        <div className="rg-ops-hub-grid">
          {workspaces.map(({ to, title, detail, icon: Icon }) => (
            <Link key={to} to={`${base}/${to}`} className="rg-ops-hub-link">
              <span className="rg-ops-hub-icon"><Icon size={21} /></span>
              <span><strong>{title}</strong><small>{detail}</small></span>
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          ))}
          <Link to={`${base}/map`} className="rg-ops-hub-link">
            <span className="rg-ops-hub-icon"><Map size={21} /></span>
            <span><strong>Operations map</strong><small>Private survey locations in Region II</small></span>
            <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </section>
      <div className="rg-dashboard-split">
        <section className="rg-panel rg-map-panel">
          <div className="rg-panel-heading">
            <div>
              <h2>Field overview</h2>
              <p>Survey locations and reviewed severity</p>
            </div>
            <Link to={`${base}/map`} className="rg-text-link">
              Open map <ArrowUpRight size={15} />
            </Link>
          </div>
          <FieldMap
            points={data.surveys
              .filter((s) => s.lat != null && s.lng != null)
              .map((s) => ({ ...s, lat: s.lat!, lng: s.lng! }))}
            onSelect={(id) => {
              window.location.hash = id;
            }}
          />
          <div className="rg-panel-footer">
            <span>
              <span className="rg-dot" />
              {data.surveys.length} survey locations
            </span>
            <small>
              {demo
                ? "Illustrative locations · not live observations"
                : "Private operator map"}
            </small>
          </div>
        </section>
        <section className="rg-panel rg-review-panel">
          <div className="rg-panel-heading">
            <div>
              <h2>Needs your review</h2>
              <p>Check the evidence before it goes out.</p>
            </div>
            <span className="rg-count">{pending.length}</span>
          </div>
          {pendingPreview ? (
            <div className="rg-review-cover">
              <img src={pendingPreview} alt="Validated preview for a survey awaiting review" />
              <span>VALIDATED RESULT · REVIEW REQUIRED</span>
            </div>
          ) : null}
          <SurveyList surveys={pending} compact />
          <Link to={`${base}/review`} className="rg-review-link">
            Open detection review <ArrowRight size={17} />
          </Link>
          <div className="rg-inline-note">
            <ShieldIcon />
            <p>
              AI drafts the finding. An operator makes the publication decision.
            </p>
          </div>
        </section>
      </div>
      <div className="rg-dashboard-bottom">
        <section className="rg-panel">
          <div className="rg-panel-heading">
            <div>
              <h2>Recent surveys</h2>
              <p>From original images to reviewed findings</p>
            </div>
            <Link className="rg-text-link" to={`${base}/surveys`}>
              View all <ArrowRight size={15} />
            </Link>
          </div>
          <SurveyList surveys={data.surveys.slice(0, 3)} />
        </section>
        <section className="rg-panel rg-readiness">
          <div className="rg-panel-heading">
            <h2>Service readiness</h2>
            <Radio size={18} />
          </div>
          {[
            ["Private Drive", data.providers.drive.replaceAll("_", " ")],
            ["Kaggle dispatcher", data.providers.kaggle.replaceAll("_", " ")],
            ["SMS gateway", data.providers.sms.replaceAll("_", " ")],
            ["Advisory provider", data.providers.advisory.replaceAll("_", " ")],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <small>{value}</small>
            </div>
          ))}
          <Link className="rg-text-link" to={`${base}/model`}>
            Check system configuration <ArrowUpRight size={15} />
          </Link>
        </section>
      </div>
    </>
  );
}
function ShieldIcon() {
  return <ClipboardCheck size={21} />;
}
export function SurveysPage() {
  const { data } = useOperations();
  const base = useBase();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  return (
    <>
      <PageHeading
        title="Drone surveys"
        text="Keep every capture, location, and processing decision in one flight record."
        action={
          <Link className="rg-button rg-primary" to={`${base}/surveys/new`}>
            <Plus size={18} />
            New survey
          </Link>
        }
      />
      <div className="rg-filter-bar">
        <label className="rg-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search surveys"
            placeholder="Search survey or location"
          />
        </label>
        <select
          aria-label="Processing state"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All processing states</option>
          {["Awaiting upload", "Validating", "Queued", "Submitting", "Waiting for GPU", "Running", "Validating results", "Needs review", "Reviewed", "Failed", "Cancelled"].map(
            (s) => (
              <option key={s}>{s}</option>
            ),
          )}
        </select>
      </div>
      <section className="rg-panel">
        <SurveyList
          surveys={data.surveys.filter(
            (s) =>
              (status === "all" || s.status === status) &&
              `${s.name} ${s.location}`
                .toLowerCase()
                .includes(query.toLowerCase()),
          )}
        />
      </section>
    </>
  );
}
export function MapPage() {
  const { data } = useOperations();
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const base = useBase();
  const s = data.surveys.find((s) => s.id === selected);
  return (
    <>
      <PageHeading
        title="The operations map"
        text="Private survey locations. Lesion polygons remain in image coordinates."
      />
      <div className="rg-filter-bar">
        <SlidersHorizontal size={18} />
        <select
          aria-label="Reviewed severity filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All reviewed severities</option>
          {["low", "moderate", "high", "not_calibrated", "unknown"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <span className="rg-muted">
          Color = reviewed severity, not confidence
        </span>
      </div>
      <FieldMap
        large
        points={data.surveys
          .filter(
            (s) =>
              s.lat != null &&
              s.lng != null &&
              (filter === "all" || s.severity === filter),
          )
          .map((s) => ({ ...s, lat: s.lat!, lng: s.lng! }))}
        onSelect={setSelected}
      />
      {s && (
        <div className="rg-map-selection">
          <div>
            <strong>{s.name}</strong>
            <p>
              {s.location} · {s.photos} photos
            </p>
          </div>
          <Status value={s.status} />
          <Link
            className="rg-button rg-primary"
            to={`${base}/review?survey=${s.id}`}
          >
            Review images <ArrowRight size={16} />
          </Link>
        </div>
      )}
    </>
  );
}
export function AdvisoryDesk() {
  const { data, demo, saveDraft, publish, generateAdvisory } = useOperations();
  const [selected, setSelected] = useState(data.bulletins[0]?.id || "");
  useEffect(() => { if (!selected && data.bulletins[0]) setSelected(data.bulletins[0].id); }, [data.bulletins, selected]);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState("");
  const [action, setAction] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const b = data.bulletins.find((b) => b.id === selected);
  const recipients =
    b?.lat != null && b.lng != null
      ? eligibleContacts(data.contacts, { lat: b.lat, lng: b.lng })
      : [];
  const sms = b
    ? `RiceGuardAI: Posibleng ${b.disease} sa ${b.location}. ${b.action} Mapa: [approved area link] Detalye: [public advisory link] Reply STOP para ihinto.`
    : "";
  const segments = smsSegments(sms);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(demo ? "Demo updated. No message was sent." : "Saved.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        title="The advisory desk"
        text="Review the finding, public location, message, and audience before approval."
      />
      <div className="rg-desk-grid">
        <aside className="rg-panel rg-draft-list">
          <h2>Drafts & publications</h2>
          {data.bulletins.map((item) => (
            <button
              key={item.id}
              className={selected === item.id ? "selected" : ""}
              onClick={() => {
                setSelected(item.id);
                setConfirmed(false);
                setEditing(false);
              }}
            >
              <span className="rg-badge">{item.disease}</span>
              <strong>{item.title}</strong>
              <small>{item.location}</small>
              <Status value={item.status} />
            </button>
          ))}
        </aside>
        {b ? (
          <section className="rg-panel rg-editor">
            <div className="rg-panel-heading">
              <h2>Advisory preview</h2>
              <Status value={b.status} />
            </div>
            <img
              className="rg-editor-image"
              src={b.image}
              alt="Advisory evidence preview"
            />
            <div className="rg-editor-content">
              <span className="rg-eyebrow">
                {b.sample
                  ? "SAMPLE EVIDENCE · NOT A LIVE DIAGNOSIS"
                  : "FIELD REVIEW"}
              </span>
              <h2>{b.title}</h2>
              <p className="rg-location">
                <MapPin size={15} />
                {b.location}
              </p>
              {editing ? (
                <>
                  <label>
                    Technical summary
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                    />
                  </label>
                  <label>
                    Recommended action
                    <textarea
                      value={action}
                      onChange={(e) => setAction(e.target.value)}
                    />
                  </label>
                  <button
                    className="rg-button rg-primary"
                    disabled={busy || !body.trim() || !action.trim()}
                    onClick={() =>
                      void act(async () => {
                        await saveDraft(b.id, body, action);
                        setEditing(false);
                        setConfirmed(false);
                      })
                    }
                  >
                    Save new draft
                  </button>
                </>
              ) : (
                <>
                  <p>{b.body}</p>
                  <h3>Recommended action</h3>
                  <p>{b.action}</p>
                  <button
                    className="rg-button rg-secondary"
                    disabled={b.status === "published"}
                    title={b.status === "published" ? "Published content requires an explicit correction version" : undefined}
                    onClick={() => {
                      setBody(b.body);
                      setAction(b.action);
                      setEditing(true);
                    }}
                  >
                    Edit draft
                  </button>
                  {!demo && b.status !== "published" && (
                    <button
                      className="rg-button rg-secondary"
                      disabled={busy || !b.result_revision}
                      onClick={() =>
                        void act(async () => {
                          const mode = await generateAdvisory(b.id);
                          toast.success(
                            mode === "ollama"
                              ? "Structured LLM draft created from approved specialist guidance."
                              : "Approved expert template draft created.",
                          );
                          setConfirmed(false);
                        })
                      }
                    >
                      Generate reviewed-source draft
                    </button>
                  )}
                </>
              )}
              <div className="rg-notice">
                <CircleAlert size={18} />
                Edits invalidate approval. Public location must be an approved
                approximate area.
              </div>
            </div>
          </section>
        ) : (
          <div className="rg-empty">
            No advisory drafts yet. Complete a detection review first.
          </div>
        )}
        <aside className="rg-panel rg-delivery-preview">
          <h2>SMS & audience</h2>
          <p className="rg-muted">
            Opted-in, verified contacts with a registered farm within 3 km.
          </p>
          <div className="rg-sms-bubble">
            <p>{sms || "Select an advisory."}</p>
          </div>
          <div className="rg-preview-stat">
            <span>{recipients.length} eligible contacts</span>
            <span>{segments.segments} estimated segments / recipient</span>
            <span>
              {segments.encoding} · final URLs may change segment count
            </span>
          </div>
          <label className="rg-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed the content, location, and recipient scope.
          </label>
          <button
            className="rg-button rg-primary"
            disabled={
              !b || !confirmed || editing || busy || b.status === "published"
            }
            onClick={() => b && void act(() => publish(b.id))}
          >
            <Check size={17} />
            {demo ? "Approve in demo" : "Approve & publish"}
          </button>
          <small>
            Publication and delivery are tracked separately. Quiet hours: 8 pm–6
            am, Manila.
          </small>
        </aside>
      </div>
    </>
  );
}
export function FarmersPage() {
  const { data, demo, addContact } = useOperations();
  const [show, setShow] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await addContact({
        id: crypto.randomUUID(),
        name: String(f.get("name")),
        phone: normalizePhone(String(f.get("phone"))),
        location: String(f.get("location")),
        consent: false,
        verified: false,
        farms: [],
      });
      toast.success(
        "Contact saved without SMS consent. Verify the number and consent before sending.",
      );
      setShow(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        title="Farmers & their fields"
        text="A contact can have multiple farms. Nearby does not imply field ownership."
        action={
          <button
            className="rg-button rg-primary"
            onClick={() => setShow(!show)}
          >
            <Plus size={17} />
            Add contact
          </button>
        }
      />
      <div className="rg-stat-grid rg-two-stats">
        <article className="rg-stat">
          <span>Pilot contacts</span>
          <strong>
            {data.contacts.length} <small>/ 100</small>
          </strong>
        </article>
        <article className="rg-stat">
          <span>Verified & opted in</span>
          <strong>
            {data.contacts.filter((c) => c.consent && c.verified).length}
          </strong>
        </article>
      </div>
      {show && (
        <form className="rg-panel rg-form" onSubmit={submit}>
          <h2>Staff-assisted contact entry</h2>
          <div className="rg-form-grid">
            <label>
              Farmer name
              <input name="name" required maxLength={120} autoComplete="name" />
            </label>
            <label>
              Mobile number
              <input
                name="phone"
                inputMode="tel"
                placeholder="09XXXXXXXXX"
                required
              />
            </label>
            <label>
              Location note
              <input
                name="location"
                required
                placeholder="Barangay, municipality, province"
              />
            </label>
          </div>
          <p className="rg-muted">
            {demo ? "Use sample numbers in this preview. " : ""}A saved number
            is not automatically opted in. No farm pin means exclusion from
            radius-based campaigns.
          </p>
          <button className="rg-button rg-primary" disabled={busy}>
            Save unverified contact
          </button>
        </form>
      )}
      <label className="rg-search">
        <Search size={18} />
        <input
          placeholder="Search farmers or locations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="rg-contact-grid">
        {data.contacts
          .filter((c) =>
            `${c.name} ${c.location}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((c) => (
            <article className="rg-panel rg-contact" key={c.id}>
              <div className="rg-inline">
                <span className="rg-avatar">{c.name[0]}</span>
                <div>
                  <h3>{c.name}</h3>
                  <p>{c.phone}</p>
                </div>
              </div>
              <p>
                <MapPin size={14} /> {c.location}
              </p>
              <div className="rg-inline">
                <Status
                  value={c.consent && c.verified ? "Verified" : "Not eligible"}
                />
                <span>{c.farms.length} registered farms</span>
              </div>
              <small>
                {c.consent ? "Consent recorded" : "No notification consent"}
              </small>
            </article>
          ))}
      </div>
    </>
  );
}
export function SmsPage() {
  const { data, demo } = useOperations();
  return (
    <>
      <PageHeading
        title="SMS delivery"
        text="Gateway acceptance is not the same as a delivered message."
      />
      <div className="rg-notice">
        <Radio size={18} />
        {demo
          ? "Demo campaigns are stored locally. No gateway calls or real sends occur."
          : "Device health must be verified before dispatch. Unknown sends require reconciliation, not blind retry."}
      </div>
      <div className="rg-stat-grid">
        {["queued", "delivered", "failed", "unknown"].map((s) => (
          <article className="rg-stat" key={s}>
            <span>{s}</span>
            <strong>
              {data.campaigns
                .filter((c) => c.status === s)
                .reduce((n, c) => n + c.recipients, 0)}
            </strong>
            <small>Recipient count</small>
          </article>
        ))}
      </div>
      <section className="rg-panel">
        <div className="rg-panel-heading">
          <h2>Notification campaigns</h2>
          <MessageSquare size={19} />
        </div>
        {data.campaigns.length ? (
          data.campaigns.map((c) => (
            <div className="rg-campaign-row" key={c.id}>
              <div>
                <strong>
                  {data.bulletins.find((b) => b.id === c.bulletin_id)?.title}
                </strong>
                <small>{c.sample ? "SIMULATION ONLY" : c.created_at}</small>
              </div>
              <span>{c.recipients} contacts</span>
              <Status value={c.status} />
            </div>
          ))
        ) : (
          <div className="rg-empty">
            <MessageSquare size={32} />
            <h3>No campaigns yet</h3>
            <p>
              Approve an advisory to create a campaign. Messages are not sent
              from the browser.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
export function SystemPage() {
  const { data } = useOperations();
  return (
    <>
      <PageHeading
        title="Model & system"
        text="Configuration, evidence, and readiness — without invented health indicators."
      />
      <div className="rg-system-grid">
        {[
          {
            title: "Disease inference",
            icon: Cpu,
            body: "Independent BLB and Brown Spot semantic adapters with overlapping native-resolution reconstruction. Empty detections are valid only after a completed, verified job.",
            status: data.providers.kaggle.replaceAll("_", " "),
          },
          {
            title: "Android SMS Gate",
            icon: MessageSquare,
            body: "Authenticated reports, consent recheck, opt-out handling and unknown-send reconciliation are required.",
            status: data.providers.sms.replaceAll("_", " "),
          },
          {
            title: "Advisory generation",
            icon: FileImage,
            body: "Server-side Ollama Cloud adapter reads only approved specialist guidance. Human approval remains mandatory.",
            status: data.providers.advisory.replaceAll("_", " "),
          },
          {
            title: "Database & privacy",
            icon: Users,
            body: "Private farm geometry and contacts. Public readers only receive approved advisory projections.",
            status: data.providers.drive.replaceAll("_", " "),
          },
        ].map((s) => (
          <article className="rg-panel rg-system-card" key={s.title}>
            <s.icon size={26} />
            <h2>{s.title}</h2>
            <p>{s.body}</p>
            <Status value={s.status} />
          </article>
        ))}
      </div>
      <section className="rg-panel">
        <div className="rg-panel-heading">
          <div>
            <h2>Active semantic checkpoints</h2>
            <p>Pinned preprocessing and calibrated inference settings</p>
          </div>
          <Status value={data.models.filter((model) => model.active).length === 2 ? "Ready" : "Configuration required"} />
        </div>
        <div className="rg-model-registry">
          {data.models.filter((model) => model.active).map((model) => (
            <article key={model.id}>
              <span className="rg-badge">{model.disease}</span>
              <h3>{model.version}</h3>
              <dl className="rg-definition">
                <dt>Architecture</dt><dd>{model.architecture}</dd>
                <dt>Encoder</dt><dd>{model.encoder}</dd>
                <dt>Native tile</dt><dd>{model.input_size}px · {Math.round(model.overlap * 100)}% overlap</dd>
                <dt>Threshold</dt><dd>{model.threshold.toFixed(3)}</dd>
                <dt>Min. component</dt><dd>{model.minimum_component_pixels.toLocaleString()} px</dd>
              </dl>
            </article>
          ))}
          {!data.models.some((model) => model.active) && <div className="rg-empty">No active model adapters. Inference is blocked until both specialist checkpoints are registered.</div>}
        </div>
      </section>
      <div className="rg-panel rg-evidence-banner">
        <div>
          <h2>Replaceable checkpoint registry</h2>
          <p>
            Active checkpoint versions, preprocessing, thresholds and validation summaries are stored server-side. Historical metrics never appear as current field evidence.
          </p>
        </div>
        <Status value="Admin only" />
      </div>
    </>
  );
}
export function SettingsPage() {
  const { demo, reset } = useOperations();
  return (
    <>
      <PageHeading
        title="Settings & guardrails"
        text="Pilot limits are explicit. Provider charges and delivery must be verified separately."
      />
      <div className="rg-system-grid">
        <section className="rg-panel rg-system-card">
          <h2>Notification policy</h2>
          <dl className="rg-definition">
            <dt>Default audience</dt>
            <dd>Verified, opted-in farms within 3 km</dd>
            <dt>Quiet hours</dt>
            <dd>20:00–06:00 Asia/Manila</dd>
            <dt>Daily advisory limit</dt>
            <dd>2 per contact</dd>
            <dt>Pilot capacity</dt>
            <dd>100 contacts</dd>
            <dt>Publication</dt>
            <dd>Operator approval required</dd>
          </dl>
        </section>
        <section className="rg-panel rg-system-card">
          <h2>Operational budget</h2>
          <div className="rg-budget">
            Quota-controlled<small>cloud processing policy</small>
          </div>
          <p>
            Kaggle is the asynchronous GPU provider. There is no automatic paid AWS fallback.
          </p>
          <p className="rg-muted">
            Free quotas remain limited. SIM load, connectivity, domain renewal and existing subscriptions are separate costs.
          </p>
        </section>
        <section className="rg-panel rg-system-card">
          <h2>Location & privacy</h2>
          <p>
            Region II only: Batanes, Cagayan, Isabela, Nueva Vizcaya, Quirino.
          </p>
          <p>
            Versioned PSGC release and approved coverage boundaries must be
            loaded before live registration. Public pins represent approximate
            areas.
          </p>
        </section>
        <section className="rg-panel rg-system-card">
          <h2>{demo ? "Demo workspace" : "Audit trail"}</h2>
          <p>
            {demo
              ? "Only this browser’s synthetic operations data is reset. No server data, training, or annotations are affected."
              : "Publication revisions and background events must be retained in the database audit log."}
          </p>
          {demo && (
            <button
              className="rg-button rg-secondary"
              onClick={() => {
                if (
                  confirm(
                    "Reset this browser’s demo surveys, drafts, and campaigns?",
                  )
                ) {
                  reset();
                  toast.success("Demo reset.");
                }
              }}
            >
              <RefreshCw size={16} />
              Reset demo fixtures
            </button>
          )}
        </section>
      </div>
    </>
  );
}
export function OperationsPage() {
  const location = useLocation();
  const page = location.pathname.split("/").slice(2).join("/");
  const navigate = useNavigate();
  if (page === "surveys/new") return <UploadWorkspace />;
  if (page === "review") return <ReviewWorkspace />;
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
      return <SystemPage />;
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
