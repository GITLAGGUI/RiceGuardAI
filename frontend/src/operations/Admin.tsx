import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { inferenceConfigurationLabel, type InferenceConfiguration } from "../../../supabase/functions/_shared/systemReadiness";
import {
  Link,
  NavLink,
  Outlet,
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
  Cpu,
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
  Bell,
  LogOut,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { Brand } from "./Public";
import { fieldSeverityForSurvey, fieldSeverityLabel } from "./severityPresentation";
import { FieldMap } from "./Map";
import { OperationsProvider, operation, useOperations } from "./store";
import { useAuth } from "@/context/AuthContext";
import {
  normalizePhone,
  type Survey,
} from "./domain";
import { UploadWorkspace } from "./Upload";
import { VerifyWorkspace } from "./VerifyFindings";
import { LivePipeline } from "./PipelineMonitor";
import { reviewedDiseaseLabel, advisoryActionSteps } from "./advisoryPresentation";
import { reviewHref } from "./ReviewJourney";
import { SmsDelivery } from "./SmsDelivery";
import "./operations.css";

const nav = [
  ["overview", "Overview", LayoutDashboard],
  ["surveys", "Drone surveys", ScanLine],
  ["map", "Operations map", Map],
  ["review", "Verify findings", ClipboardCheck],
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
    { to: "review", title: "Verify findings", detail: `${pending.length} naghihintay ng Tama/Mali`, icon: ClipboardCheck },
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
      <LivePipeline />
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
              .map((s) => ({ ...s, severity: fieldSeverityForSurvey(s, data.bulletins), lat: s.lat!, lng: s.lng! }))}
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
      <div className="rg-filter-bar rg-map-filter">
        <SlidersHorizontal size={18} />
        <select
          aria-label="Reviewed severity filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All reviewed severities</option>
          {["low", "moderate", "high", "not_calibrated"].map((x) => (
            <option key={x} value={x}>{fieldSeverityLabel(x as Survey["severity"])}</option>
          ))}
        </select>
        <span className="rg-muted">
          Color = reviewed severity, not confidence
        </span>
      </div>
      <FieldMap
        large
        points={data.surveys.map(s => ({ ...s, severity: fieldSeverityForSurvey(s, data.bulletins) }))
          .filter(
            (s) =>
              s.lat != null &&
              s.lng != null &&
              (filter === "all" || s.severity === filter || (filter === "not_calibrated" && s.severity === "unknown")),
          )
          .map((s) => ({ ...s, lat: s.lat!, lng: s.lng! }))}
        onSelect={setSelected}
        focusId={selected || undefined}
      />
      <section className="rg-panel rg-map-posts"><h2>Survey pins and publication</h2><p>A private pin does not create a public post. Review the location and publish separately.</p>
        <ul className="rg-map-post-list">{data.surveys.map(item => { const advisory=data.bulletins.find(b=>b.survey_id===item.id && b.result_revision===item.active_result_revision); return <li key={item.id} className={selected===item.id?"selected":""}>
          <div><strong>{item.name}</strong><small>Survey {item.id.slice(0,8)} · {item.location}</small><div className="rg-map-statuses"><span>{item.lat==null || item.lng==null ? "No private GPS pin" : "Private pin saved"}</span><span>{advisory?.status==="published" ? "Published" : "Not published"}</span><span>{advisory?.public_location_approved ? "Public area approved" : "No public map approval"}</span></div></div>
          <div className="rg-map-record-actions">{item.lat!=null && item.lng!=null?<button type="button" className="rg-button rg-secondary" onClick={()=>setSelected(item.id)}><MapPin size={16}/> Locate</button>:null}<Link className="rg-button rg-secondary" to={reviewHref(item.id,advisory?.id)}>Open review <ArrowRight size={16}/></Link></div></li>; })}</ul>
      </section>
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
  const {data,demo,refresh}=useOperations();
  const [params,setParams]=useSearchParams();
  const [deleting,setDeleting]=useState(false);
  const [busy,setBusy]=useState(false);
  const requested=params.get("advisory");
  const surveyId=params.get("survey");
  const b=requested ? data.bulletins.find(item=>item.id===requested && (!surveyId || item.survey_id===surveyId))
    : surveyId ? data.bulletins.find(item=>item.survey_id===surveyId) : data.bulletins[0];
  return <><PageHeading title="The advisory desk" text="Find an advisory, then continue its guided review. Pinning, publishing and SMS are separate steps."/>
    <div className="rg-desk-grid rg-desk-guided">
      <aside className="rg-panel rg-draft-list"><h2>Drafts & publications</h2>{data.bulletins.map(item=><button key={item.id} className={b?.id===item.id ? "selected" : ""} onClick={()=>{setParams({advisory:item.id,...(item.survey_id ? {survey:item.survey_id} : {})});setDeleting(false);}}>
        <span className="rg-badge">{reviewedDiseaseLabel(item)}</span><strong>{item.title}</strong><small>{item.location} · {item.id.slice(0,8)} · {item.date}</small><Status value={item.status}/></button>)}</aside>
      {b ? <section className="rg-panel rg-editor"><div className="rg-panel-heading"><h2>{b.title}</h2><Status value={b.status}/></div><img className="rg-editor-image" src={b.image} alt="Advisory preview"/>
        <div className="rg-editor-content"><p>{b.location} · {b.id.slice(0,8)}</p><p>{b.body}</p><h3>Recommended actions</h3><ul>{advisoryActionSteps(b.action).map((text,i)=><li key={i}>{text}</li>)}</ul>
          <p>{b.status==="published" ? "Published. A reviewed correction is required for changes." : "Draft. No public post or SMS is created by a private map pin."}</p>
          {b.survey_id ? <Link className="rg-button rg-primary" to={reviewHref(b.survey_id,b.id,b.status==="published" ? "publish" : "images")}>{b.status==="published" ? "View review / create correction" : "Continue guided review"}</Link> : <p role="alert">This advisory has no bound survey. Publication is unavailable.</p>}
          {b.status==="published" ? <Link className="rg-button rg-secondary" to={"/advisories/"+b.slug}>View public post</Link> : null}
          {!demo ? <><button type="button" className="rg-button rg-secondary" onClick={()=>setDeleting(true)}>Delete advisory</button>
            {deleting ? <div role="alert" className="rg-delete-confirm"><strong>Withdraw “{b.title}”?</strong><p>This recoverably archives the advisory, withdraws its public post and suppresses queued SMS. Original survey media remain unchanged.</p>
              <button type="button" className="rg-button rg-secondary" disabled={busy} onClick={()=>setDeleting(false)}>Cancel</button><button type="button" className="rg-button rg-primary" disabled={busy} onClick={async()=>{
                setBusy(true);try{await operation("archive-advisory",{id:b.id,advisory_revision:b.advisory_revision,confirmed:true});setDeleting(false);await refresh();toast.success("Advisory archived; original media preserved.");}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}
              }}>Confirm withdrawal</button></div> : null}</> : null}
        </div></section> : <div role="alert" className="rg-empty">{requested || surveyId ? "The requested advisory is unavailable. Another record has not been substituted." : "No drafts yet. Complete image review first."}</div>}
    </div><section id="guidance-library"><GuidanceSourceReview demo={demo} selectedSourceIds={b?.advisory_source_ids || []}/></section></>;
}
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
export function SystemPage() {
  const { data, operation } = useOperations();
  const [configuration,setConfiguration]=useState<InferenceConfiguration|null>(null);
  const [configurationError,setConfigurationError]=useState("");
  useEffect(()=>{
    let active=true;
    operation("system-readiness").then(result=>{if(active)setConfiguration(result.inference);})
      .catch(()=>{if(active)setConfigurationError("Server configuration could not be checked. Do not assume that a new upload can process.");});
    return()=>{active=false;};
  },[operation]);
  const activeModels=data.models.filter(model=>model.active);
  const registryPair=["BLB","Brown Spot"].every(disease=>activeModels.filter(model=>model.disease===disease).length===1);
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
            status: inferenceConfigurationLabel(configuration),
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
            status: data.providers.advisory === "connected" ? "Credentials configured" : data.providers.advisory.replaceAll("_", " "),
          },
          {
            title: "Private original-media storage",
            icon: Users,
            body: "Google Drive stores private originals. Contact records and private farm geometry remain in the protected database.",
            status: data.providers.drive === "connected" ? "Credentials configured" : data.providers.drive.replaceAll("_", " "),
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
      <section className="rg-panel rg-system-card" aria-label="Pinned inference configuration">
        <h2>Pinned photo and video workflow</h2>
        <p>BLB and Brown Spot are processed by the hash-pinned dual-model pathway, not the optional adapter registry below.</p>
        {configuration ? <><p>Uploads: {configuration.upload_enabled ? "enabled" : "disabled"}. Dispatch: {configuration.dispatch_enabled ? "enabled" : "disabled"}. Callback: {configuration.callback_enabled ? "enabled" : "disabled"}.</p>
          <p className="rg-muted">Workflow SHA-256: <code style={{overflowWrap:"anywhere"}}>{configuration.workflow_sha256}</code></p></> : null}
        {configurationError ? <p role="alert">{configurationError}</p> : null}
        <p>These checks report configuration only. A completed, validated job is required to prove execution. GPU availability and SMS delivery are checked separately.</p>
      </section>
      <section className="rg-panel">
        <div className="rg-panel-heading">
          <div>
            <h2>Optional adapter registry</h2>
            <p>Separate registry entries do not replace the pinned workflow</p>
          </div>
          <Status value={registryPair ? "Both disease entries registered" : "No complete registry pair"} />
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
          {!activeModels.length && <div className="rg-empty">No optional adapter entries are registered. This does not disable the separately pinned photo and video workflow.</div>}
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
