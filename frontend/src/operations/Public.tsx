import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Link, NavLink, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  Clock3,
  Droplets,
  Info,
  HelpCircle,
  MapPin,
  Menu,
  Play,
  ScanLine,
  ShieldCheck,
  MessageSquareText,
  Thermometer,
  Wind,
  X,
} from "lucide-react";
import {
  Article as PhArticle,
  BellSimple as PhBell,
  BookmarkSimple as PhBookmark,
  CalendarBlank as PhCalendar,
  CheckCircle as PhCheckCircle,
  ChatCircleText as PhChat,
  House as PhHouse,
  MapPin as PhMapPin,
  MapTrifold as PhMap,
  MagnifyingGlass as PhSearch,
  ShareNetwork as PhShare,
  ShieldCheck as PhShield,
  SlidersHorizontal as PhFilters,
  Plant as PhSprout,
  X as PhX,
} from "@phosphor-icons/react";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { bulletinMapPoint, toBulletin, usePublicPosts, type PublicPostRow } from "./publicPosts";
import { FieldMap } from "./LazyMap";
import { groupMapPoints, publicMapSummary } from "./mapPoints";
import type { Bulletin } from "./domain";
import { AssistantWidget, BulletinWalkthrough, openBulletinWalkthrough } from "./Assistant";
import { useSmsRegistrationStatus } from "./registrationStatus";
import { socialMosaicItems } from "./bulletinMedia";
import { reviewedDiseaseLabel, advisoryActionSteps } from "./advisoryPresentation";
import { advisoryPreview } from "./advisoryContent";
import { weatherForBulletin, type BulletinWeather } from "./weatherPresentation";
import { WeatherLocation } from "./WeatherLocation";
import "./operations.css";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link to="/" className={`rg-brand ${light ? "light" : ""}`}>
      <span><img src="/images/mascot/field-companion.png" alt="" /></span>
      RiceGuard<span className="rg-brand-ai">AI</span>
    </Link>
  );
}

export function PublicFrame({
  children,
  bulletin = false,
}: {
  children: ReactNode;
  bulletin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const registered = useSmsRegistrationStatus();
  const smsPath = registered ? "/preferences" : "/register";
  return (
    <div className={`rg-public rg-public-v2 ${bulletin ? "rg-public-bulletin-mode" : ""}`}>
      <a className="rg-skip" href="#main">
        Skip to content
      </a>
      {!bulletin ? <header className="rg-public-header rg-public-header-v2">
        <Brand />
        <nav className={open ? "open" : ""} aria-label="Main navigation">
          <NavLink to="/bulletin" onClick={() => setOpen(false)}>
            <PhArticle size={18} /> <span>Field advisories</span>
          </NavLink>
          <NavLink to="/map" onClick={() => setOpen(false)}>
            <PhMap size={18} /> <span>Monitoring map</span>
          </NavLink>
          <NavLink to={smsPath} onClick={() => setOpen(false)}>
            <PhChat size={18} /> <span>{registered ? "SMS preferences" : "SMS alerts"}</span>
          </NavLink>
        </nav>
        <div className="rg-header-actions">
          <Link className="rg-button rg-primary" to={smsPath}>
            {registered ? "SMS preferences" : "Get SMS alerts"} <MessageSquareText size={16} />
          </Link>
          <button
            className="rg-mobile-menu rg-icon-button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </header> : null}
      <main id="main">{children}</main>
      {!bulletin ? <footer className="rg-footer rg-footer-v2">
        <div>
          <Brand light />
          <p>
            Reviewed field information for more informed rice-crop decisions.
          </p>
        </div>
        <div>
          <strong>Public information</strong>
          <Link to="/bulletin">Field advisories</Link>
          <Link to="/map">Monitoring map</Link>
          <Link to={smsPath}>{registered ? "SMS preferences" : "SMS registration"}</Link>
        </div>
        <div>
          <strong>Account</strong>
          <Link to="/preferences">Alert preferences</Link>
          <Link to="/login">Authorized staff login</Link>
        </div>
        <small>
          RiceGuardAI · Region II, Philippines
          <br />
          Decision support only. Field verification remains required.
        </small>
      </footer> : null}
      {!bulletin ? <nav className="rg-public-bottom" aria-label="Mobile navigation">
        <NavLink to="/bulletin">
          <ScanLine size={19} /> Advisory
        </NavLink>
        <NavLink to="/map">
          <MapPin size={19} /> Map
        </NavLink>
        <NavLink to={smsPath}>
          <MessageSquareText size={19} /> {registered ? "Preferences" : "SMS"}
        </NavLink>
      </nav> : null}
      <AssistantWidget compact={bulletin} launcher={bulletin} />
    </div>
  );
}

export { HomePage } from "./landing/HomeLanding";

function HonestState({ title, text }: { title: string; text: string }) {
  return (
    <div className="rg-empty rg-honest-state">
      <ShieldCheck size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("riceguard-public-bookmarks") || "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    const sync = () => {
      try { setBookmarks(JSON.parse(localStorage.getItem("riceguard-public-bookmarks") || "[]")); }
      catch { setBookmarks([]); }
    };
    window.addEventListener("riceguard-bookmarks", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("riceguard-bookmarks", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const toggle = (id: string) => {
    setBookmarks((current) => {
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      localStorage.setItem("riceguard-public-bookmarks", JSON.stringify(next));
      queueMicrotask(() => window.dispatchEvent(new Event("riceguard-bookmarks")));
      return next;
    });
  };
  return { bookmarks, toggle };
}

export function BulletinCard({ item }: { item: Bulletin }) {
  const { bookmarks, toggle } = useBookmarks();
  const bookmarked = bookmarks.includes(item.id);
  const media = item.media?.length
    ? item.media
    : item.image
      ? [{ url: item.image, alt: `Approved public preview for ${item.title}`, type: "image" as const }]
      : [];
  const summary = item.body;
  const corrected = Boolean(item.revision && item.revision > 1) || Boolean(
    item.updated_at && item.published_at && item.updated_at !== item.published_at,
  );
  const share = async () => {
    const url = `${location.origin}/advisories/${item.slug}`;
    if (navigator.share) await navigator.share({ title: professionalAdvisoryTitle(item), url });
    else await navigator.clipboard.writeText(url);
  };
  return (
    <article className="rg-bulletin-post">
      <div className="rg-bulletin-post-head">
        <span className="rg-bulletin-avatar" aria-hidden="true"><img src="/images/mascot/field-companion.png" alt="" /></span>
        <div className="rg-bulletin-publisher">
          <strong>RiceGuardAI Field Monitoring <PhCheckCircle size={16} weight="fill" /></strong>
          <small>{formatDate(item.published_at || item.date)} · {item.location}</small>
        </div>
        <div className="rg-post-statuses">
          {(item.diseases?.length ? item.diseases : [item.disease]).map((disease) => (
            <span key={disease} className={`rg-disease-pill ${disease === "BLB" ? "blb" : "brown"}`}>
              {disease === "BLB" ? "Bacterial Leaf Blight" : "Brown Spot"}
            </span>
          ))}
          <span className="rg-reviewed-pill"><PhCheckCircle size={14} weight="fill" /> Reviewed</span>
          {corrected ? <span className="rg-updated-pill">Updated</span> : null}
        </div>
      </div>

      <div className={`rg-bulletin-post-body ${media.length > 1 ? "has-gallery" : ""}`}>
        <div className="rg-post-narrative">
          <h2><Link to={`/advisories/${item.slug}`}>{professionalAdvisoryTitle(item)}</Link></h2>
          <ExpandableAdvisory summary={professionalAdvisorySummary(summary, item)} action={item.action} />
        </div>
        {media.length ? <BulletinMediaGallery item={item} compact /> : null}
      </div>

      <footer className="rg-bulletin-post-actions">
        <Link to={`/advisories/${item.slug}`}>View details <ArrowRight size={15} /></Link>
          <button onClick={() => toggle(item.id)} aria-pressed={bookmarked} aria-label={bookmarked ? "Remove saved advisory" : "Save advisory"}>
          <PhBookmark size={20} weight={bookmarked ? "fill" : "regular"} />
          <span>{bookmarked ? "Saved" : "Save"}</span>
        </button>
          <button onClick={() => void share()} aria-label="Share advisory"><PhShare size={20} /><span>Share</span></button>
      </footer>
    </article>
  );
}

function BulletinMediaGallery({ item, compact = false }: { item: Bulletin; compact?: boolean }) {
  const media = item.media?.length
    ? item.media
    : item.image
      ? [{ url: item.image, alt: `Approved public preview for ${item.title}`, type: "image" as const }]
      : [];
  const [selected, setSelected] = useState(0);
  const [videoStarted, setVideoStarted] = useState(false);
  const pointerStart = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeIndex = Math.min(selected, Math.max(media.length - 1, 0));
  const active = media[activeIndex];
  const select = (next: number) => {
    setSelected((next + media.length) % media.length);
    setVideoStarted(false);
  };
  if (!active) return null;
  if (compact) {
    const { visible, remaining } = socialMosaicItems(media);
    return (
      <Link
        to={`/advisories/${item.slug}`}
        className={`rg-social-media-mosaic count-${Math.min(visible.length, 5)}`}
        aria-label={`Open all ${media.length} approved media items for ${item.title}`}
      >
        {visible.map((entry, index) => (
          <span className="rg-social-media-cell" key={`${entry.url}-${index}`}>
            {entry.type === "video" ? (
              <video src={entry.url} muted playsInline preload="metadata" aria-hidden="true" />
            ) : (
              <img src={entry.url} alt="" loading="lazy" />
            )}
            {entry.type === "video" ? <span className="rg-social-media-kind">Video</span> : null}
            {remaining > 0 && index === visible.length - 1 ? (
              <span className="rg-social-media-more">+{remaining}</span>
            ) : null}
          </span>
        ))}
      </Link>
    );
  }
  return (
    <section className="rg-bulletin-gallery detail" aria-label={`Approved media for ${professionalAdvisoryTitle(item)}`}>
      <div
        className="rg-bulletin-media-stage"
        onPointerDown={(event) => { pointerStart.current = event.clientX; }}
        onPointerUp={(event) => {
          if (pointerStart.current == null || media.length < 2) return;
          const distance = event.clientX - pointerStart.current;
          pointerStart.current = null;
          if (Math.abs(distance) > 45) select(activeIndex + (distance < 0 ? 1 : -1));
        }}
      >
        {media.length > 1 ? <button className="rg-gallery-arrow previous" type="button" onClick={() => select(activeIndex - 1)} aria-label="Previous media"><ChevronLeft /></button> : null}
        {active.type === "video" ? (
          <div className="rg-video-playback">
            <video
              ref={videoRef}
              key={active.url}
              src={active.url}
              controls={videoStarted}
              playsInline
              preload="metadata"
              aria-label={active.alt || `Field assessment video for ${professionalAdvisoryTitle(item)}`}
              onEnded={() => setVideoStarted(false)}
            />
            {!videoStarted ? <button type="button" className="rg-tap-to-play" onClick={() => { setVideoStarted(true); void videoRef.current?.play(); }}><Play size={26} fill="currentColor" /> Tap to play video</button> : null}
          </div>
        ) : (
          <Link to={`/advisories/${item.slug}`} aria-label={`Open ${professionalAdvisoryTitle(item)}`}>
            <img src={active.url} alt={active.alt} loading="lazy" />
          </Link>
        )}
        {media.length > 1 ? <button className="rg-gallery-arrow next" type="button" onClick={() => select(activeIndex + 1)} aria-label="Next media"><ChevronRight /></button> : null}
      </div>
      {media.length > 1 ? (
        <div className="rg-bulletin-media-pagination" aria-label="Media position">
          <span>{activeIndex + 1} / {media.length}</span>
          <div>{media.map((entry, index) => (
            <button
              key={`${entry.url}-${index}`}
              type="button"
              aria-label={`Open media ${index + 1}`}
              aria-current={index === activeIndex ? "true" : undefined}
              className={index === activeIndex ? "selected" : ""}
              onClick={() => select(index)}
            />
          ))}</div>
        </div>
      ) : null}
    </section>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function professionalAdvisoryTitle(item: Bulletin) {
  if (!/^reviewed rice field assessment/i.test(item.title)) return item.title;
  const place = item.location.split(",").slice(0, 2).join(",").trim() || "the monitored field";
  return `Rice Health Advisory for ${place}`;
}

function professionalAdvisorySummary(summary: string, item: Bulletin) {
  if (!/^the reviewed image findings indicate possible/i.test(summary)) return summary;
  const diseases = (item.diseases?.length ? item.diseases : [item.disease])
    .map((value) => value === "BLB" ? "Bacterial Leaf Blight" : value)
    .join(" and ");
  return `RiceGuardAI identified image patterns consistent with ${diseases} in the submitted field media. The advisory combines these model findings with the recorded location, nearby weather, and approved agricultural guidance.`;
}

function AdvisoryActionList({ action }: { action: string }) {
  const steps = advisoryActionSteps(action);
  return steps.length > 1
    ? <ul className="rg-action-list">{steps.map((step, index) => <li key={`${index}:${step}`}>{step}</li>)}</ul>
    : <p>{steps[0]}</p>;
}

function ExpandableAdvisory({ summary, action }: { summary: string; action: string }) {
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const preview = advisoryPreview(summary, action);
  return <div ref={root} className="rg-expandable-advisory">
    <p className="rg-post-summary">{expanded ? summary : preview.summary}</p>
    <div className="rg-post-recommendation"><PhSprout size={22} weight="bold" />
      <div><strong>Recommended actions</strong>{expanded ? <AdvisoryActionList action={action} /> : <ul className="rg-action-list">{preview.actions.map((step, index) => <li key={index}>{step}</li>)}</ul>}</div>
    </div>
    {preview.expandable ? <button type="button" className="rg-see-more" aria-expanded={expanded} onClick={() => {
      const collapsing = expanded;
      setExpanded(!expanded);
      if (collapsing) requestAnimationFrame(() => { root.current?.scrollIntoView({ block: "nearest", behavior: "auto" }); root.current?.querySelector<HTMLButtonElement>(".rg-see-more")?.focus({ preventScroll: true }); });
    }}>{expanded ? "See less / I-collapse" : "See more…"}</button> : null}
  </div>;
}

function assessmentLabel(value: Bulletin["severity"]) {
  if (value === "not_calibrated" || value === "unknown") return "Field severity not assessed";
  return `${value === "high" ? "Severe" : value[0].toUpperCase() + value.slice(1)} · field category`;
}

type CommunityPage = "bulletin" | "map" | "sms";
type CommunityPoints = ComponentProps<typeof FieldMap>["points"];
function useNearbyWeather(locationCode: string) {
  const pointKey = locationCode;
  const [result, setResult] = useState<{
    key: string;
    weather: BulletinWeather | null;
    error: string;
    location: string;
  }>({ key: "", weather: null, error: "", location: "" });

  useEffect(() => {
    if (!locationCode || !supabaseConfigured) return;
    let active = true;
    const fetchWeather = () => { void supabase.functions.invoke("weather", {
      body: { location_code: locationCode },
    }).then(({ data, error: weatherError }) => {
      if (!active) return;
      const normalized = weatherForBulletin(data);
      if (weatherError || !normalized) {
        setResult({ key: pointKey, weather: null, error: "Weather for this area is unavailable. Try a nearby municipality.", location: "" });
      } else {
        setResult({ key: pointKey, weather: normalized, error: "", location: data.location_meta?.label || "Selected area" });
      }
    }).catch(() => {
      if (active) {
        setResult({ key: pointKey, weather: null, error: "Nearby weather is temporarily unavailable.", location: "" });
      }
    }); };
    fetchWeather();
    const timer = window.setInterval(() => { if (!document.hidden) fetchWeather(); }, 10 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [pointKey, locationCode]);

  if (!locationCode) return { weather: null, loading: false, error: "Select your farm municipality to view its weather.", location: "" };
  if (!supabaseConfigured) return { weather: null, loading: false, error: "Weather service is not configured." };
  if (result.key !== pointKey) return { weather: null, loading: true, error: "" };
  return { weather: result.weather, loading: false, error: result.error, location: result.location };
}

function WeatherContextCard() {
  const [locationCode, setLocationCode] = useState("");
  const { weather, loading, error, location } = useNearbyWeather(locationCode);
  return (
    <section className="rg-bulletin-weather" aria-live="polite">
      <header>
        <span><CloudRain size={24} /></span>
        <div>
          <h2>Local weather</h2>
          <p>{location || "Choose a Region II area"}</p>
        </div>
      </header>
      <WeatherLocation onSelect={setLocationCode} />
      {loading ? <p className="rg-weather-state">Loading current conditions…</p> : null}
      {!loading && error ? <p className="rg-weather-state">{error}</p> : null}
      {!loading && weather ? (
        <>
          <strong className="rg-weather-condition">{weather.condition}</strong>
          <div className="rg-weather-metrics">
            <span><Thermometer size={16} /><b>{weather.temperatureC === null ? "—" : `${Math.round(weather.temperatureC)}°C`}</b><small>Temperature</small></span>
            <span><Droplets size={16} /><b>{weather.humidityPct === null ? "—" : `${Math.round(weather.humidityPct)}%`}</b><small>Humidity</small></span>
            <span><Wind size={16} /><b>{weather.windMS === null ? "—" : `${weather.windMS.toFixed(1)} m/s`}</b><small>Wind</small></span>
            <span><CloudRain size={16} /><b>{weather.rainChancePct === null ? "—" : `${weather.rainChancePct}%`}</b><small>Next 3h rain chance</small></span>
          </div>
          {weather.insights[0] ? <p className="rg-weather-insight">{weather.insights[0]}</p> : null}
          {weather.observedAt ? <small>OpenWeather · observed {new Date(weather.observedAt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small> : null}
        </>
      ) : null}
    </section>
  );
}

export function CommunityShell({
  active,
  children,
  points = [],
  savedSelected = false,
  onToggleSaved,
}: {
  active: CommunityPage;
  children: ReactNode;
  points?: CommunityPoints;
  savedSelected?: boolean;
  onToggleSaved?: () => void;
}) {
  const savedLink = "/bulletin?saved=1";
  const registered = useSmsRegistrationStatus();
  const smsPath = registered ? "/preferences" : "/register";
  return (
    <PublicFrame bulletin>
      <div className="rg-social-bulletin-shell">
        <aside className="rg-bulletin-side-nav" aria-label="Public navigation">
          <Brand />
          <nav data-tour="navigation">
            <Link to="/"><PhHouse size={23} /> <span>Home</span></Link>
            <Link to="/bulletin" className={active === "bulletin" && !savedSelected ? "active" : ""} aria-current={active === "bulletin" && !savedSelected ? "page" : undefined}><PhArticle size={23} /> <span>Field Bulletin</span></Link>
            <Link to="/map" className={active === "map" ? "active" : ""} aria-current={active === "map" ? "page" : undefined}><PhMap size={23} /> <span>Monitoring Map</span></Link>
            <Link to={smsPath} className={active === "sms" ? "active" : ""} aria-current={active === "sms" ? "page" : undefined}><PhChat size={23} /> <span>{registered ? "SMS Preferences" : "SMS Alerts"}</span></Link>
            {onToggleSaved ? (
              <button className={savedSelected ? "active" : ""} onClick={onToggleSaved} aria-pressed={savedSelected}>
                <PhBookmark size={23} weight={savedSelected ? "fill" : "regular"} /> <span>Saved</span>
              </button>
            ) : <Link to={savedLink}><PhBookmark size={23} /> <span>Saved</span></Link>}
          </nav>
        </aside>

        <div className="rg-bulletin-mobile-top">
          <Brand />
          <Link to={smsPath}><PhBell size={19} /> {registered ? "Preferences" : "SMS alerts"}</Link>
        </div>

        <div className="rg-social-bulletin-main">{children}</div>

        <aside className="rg-bulletin-utility" aria-label="Field information">
          {active !== "map" ? (
            <section className="rg-bulletin-mini-map">
              <h2>Monitoring activity <small>(approximate)</small></h2>
              <div><FieldMap publicView points={points} /></div>
              <p><PhMapPin size={17} weight="fill" /> Markers show approved approximate areas only. Exact farm coordinates are not disclosed.</p>
              <Link to="/map">Open monitoring map <ArrowRight size={15} /></Link>
            </section>
          ) : (
            <section className="rg-community-tip">
              <PhMap size={28} />
              <h2>Region II monitoring</h2>
              <p>Browse approved survey areas. A map point represents an approximate location, not an individual leaf.</p>
              <Link to="/bulletin">Read field bulletins <ArrowRight size={15} /></Link>
            </section>
          )}
          {active === "bulletin" ? <WeatherContextCard /> : null}
          {active !== "sms" && !registered ? (
            <section className="rg-bulletin-sms-card">
              <span><PhChat size={26} weight="fill" /></span>
              <h2>Field updates by SMS</h2>
              <p>Receive reviewed BLB and Brown Spot notices relevant to your registered farm.</p>
              <Link to="/register">Register for SMS alerts <MessageSquareText size={17} /></Link>
              <small>Consent and verified location are required.</small>
            </section>
          ) : null}
          <section className="rg-bulletin-policy">
            <PhShield size={25} weight="fill" />
            <div><h2>Publication policy</h2><p>Authorized staff review every post. Results support decisions and do not replace field confirmation.</p></div>
          </section>
        </aside>

        <nav className="rg-bulletin-mobile-nav" aria-label="Mobile public navigation" data-tour="navigation">
          <Link to="/"><PhHouse size={22} /><span>Home</span></Link>
          <Link to="/bulletin" className={active === "bulletin" && !savedSelected ? "active" : ""}><PhArticle size={22} /><span>Bulletin</span></Link>
          <Link to="/map" className={active === "map" ? "active" : ""}><PhMap size={22} /><span>Map</span></Link>
          <Link to={smsPath} className={active === "sms" ? "active" : ""}><PhChat size={22} /><span>{registered ? "Preferences" : "SMS"}</span></Link>
          {onToggleSaved ? <button onClick={onToggleSaved} className={savedSelected ? "active" : ""} aria-pressed={savedSelected}><PhBookmark size={22} weight={savedSelected ? "fill" : "regular"} /><span>Saved</span></button> : <Link to={savedLink}><PhBookmark size={22} /><span>Saved</span></Link>}
        </nav>
      </div>
    </PublicFrame>
  );
}

export function BulletinPage() {
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [disease, setDisease] = useState("all");
  const [date, setDate] = useState("");
  const [bookmarkedOnly, setBookmarkedOnly] = useState(() => new URLSearchParams(window.location.search).get("saved") === "1");
  const { bookmarks } = useBookmarks();
  const { items, error, loading, hasMore, loadMore } = usePublicPosts({
    disease,
    location: locationFilter,
    date,
    limit: 10,
  });
  const visible = useMemo(
    () => items.filter((item) => {
      const matches = `${item.title} ${item.body} ${item.location}`.toLowerCase().includes(search.toLowerCase());
      return matches && (!bookmarkedOnly || bookmarks.includes(item.id));
    }),
    [items, search, bookmarkedOnly, bookmarks],
  );

  const clearFilters = () => {
    setSearch("");
    setLocationFilter("");
    setDisease("all");
    setDate("");
    setBookmarkedOnly(false);
  };
  const mapPoints = visible
    .filter((item) => item.lat != null && item.lng != null)
    .map(bulletinMapPoint);

  return (
    <CommunityShell active="bulletin" points={mapPoints} savedSelected={bookmarkedOnly} onToggleSaved={() => setBookmarkedOnly(!bookmarkedOnly)}>
          <BulletinWalkthrough hasAdvisories={visible.length > 0} />
          <header className="rg-social-bulletin-heading">
            <h1>Field Bulletin</h1>
            <button className="rg-tour-replay" onClick={openBulletinWalkthrough}><HelpCircle size={18} /> Gabay</button>
            <img src="/images/mascot/bulletin-reader-v2.png" alt="RiceGuardAI field companion reading a field bulletin" />
          </header>

          <section className="rg-bulletin-filter-bar" aria-label="Filter advisories" data-tour="filters">
            <label className="rg-bulletin-search">
              <span className="sr-only">Search advisories</span>
              <PhSearch size={20} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search BLB, Brown Spot, or location" />
              {search ? <button onClick={() => setSearch("")} aria-label="Clear search"><PhX size={17} /></button> : null}
            </label>
            <label><span>Disease</span><select value={disease} onChange={(event) => setDisease(event.target.value)}><option value="all">All target diseases</option><option value="BLB">Bacterial Leaf Blight</option><option value="Brown Spot">Brown Spot</option></select></label>
            <label><span>Municipality / barangay</span><input value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} placeholder="All areas" /></label>
            <label><span>Date</span><div><PhCalendar size={18} /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div></label>
            <button className="rg-clear-filters" onClick={clearFilters}><PhFilters size={18} /> Clear</button>
          </section>

          <div className="rg-feed-context rg-social-feed-context">
            <strong>{visible.length} reviewed {visible.length === 1 ? "advisory" : "advisories"}</strong>
            <span>Newest first</span>
          </div>
          <section className="rg-social-feed" aria-live="polite" data-tour="feed">
            {error && <HonestState title="The bulletin is unavailable" text={error} />}
            {loading && !items.length ? <div className="rg-feed-skeleton"><i /><i /><i /></div> : null}
            {visible.map((item) => <BulletinCard key={item.id} item={item} />)}
            {!loading && !visible.length && !error ? <HonestState title="No matching advisories" text="Only approved and published findings appear here. Clear the filters to view other reviewed notices." /> : null}
            {hasMore ? <button className="rg-button rg-secondary rg-load-more" disabled={loading} onClick={() => void loadMore()}>Load older advisories <ChevronDown size={17} /></button> : null}
          </section>
    </CommunityShell>
  );
}

function useAdvisory(slug?: string) {
  const [item, setItem] = useState<Bulletin | null>(null);
  const canLoad = Boolean(slug && supabaseConfigured);
  const [loading, setLoading] = useState(canLoad);
  const [error, setError] = useState(() =>
    canLoad ? "" : !supabaseConfigured ? "This advisory cannot be opened right now. Please try again later." : "Advisory not found.",
  );
  useEffect(() => {
    if (!slug || !supabaseConfigured) return;
    let active = true;
    supabase.from("rg_public_posts").select("*").eq("slug", slug).maybeSingle().then(({ data, error: fetchError }) => {
      if (!active) return;
      setItem(data ? toBulletin(data as PublicPostRow) : null);
      setError(fetchError || !data ? "Advisory not found or no longer published." : "");
      setLoading(false);
    });
    return () => { active = false; };
  }, [slug]);
  return { item, loading, error };
}

export function AdvisoryPage() {
  const { slug } = useParams();
  const { item: b, loading, error } = useAdvisory(slug);
  if (!b) return <PublicFrame><div className="rg-advisory-state"><HonestState title={loading ? "Loading advisory" : "Advisory unavailable"} text={loading ? "Retrieving the approved publication…" : error} /><Link to="/bulletin">Return to bulletin</Link></div></PublicFrame>;
  const corrected = b.updated_at && b.published_at && b.updated_at !== b.published_at;
  return (
    <PublicFrame>
      <article className="rg-public-advisory">
        <Link to="/bulletin" className="rg-back-link">← Field bulletin</Link>
        <header>
          <div><span className="rg-badge">{reviewedDiseaseLabel(b)}</span><span className="rg-reviewed"><CheckCircle2 size={15} /> Reviewed publication</span></div>
          <h1>{professionalAdvisoryTitle(b)}</h1>
          <p><MapPin size={17} /> {b.location}<Clock3 size={16} /> Published {formatDate(b.published_at || b.date)}</p>
          {corrected ? <div className="rg-correction">Updated {formatDate(b.updated_at!)} · Revision {b.revision}</div> : null}
        </header>
        {(b.media?.length || b.image) ? <BulletinMediaGallery item={b} /> : null}
        <div className="rg-advisory-body">
          <section><h2>AI field assessment</h2><ExpandableAdvisory key={`${b.id}:${b.updated_at}`} summary={professionalAdvisorySummary(b.body, b)} action={b.action} />
            {Boolean(b.advisory_sources?.length) && <div className="rg-advisory-citations"><h2>Agricultural sources</h2><ul>{b.advisory_sources?.map((source) => <li key={`${source.disease}:${source.version}`}><a href={source.reference} target="_blank" rel="noopener noreferrer">{source.title}</a> <span>({source.disease})</span></li>)}</ul></div>}
          </section>
          <aside>
            <ShieldCheck size={25} />
            <h2>{assessmentLabel(b.severity)}</h2>
            <p>Model output supports review; it does not independently confirm a field diagnosis.</p>
            <dl><dt>Reviewer</dt><dd>{b.reviewer || "Authorized RiceGuardAI staff"}</dd><dt>Location</dt><dd>Approximate public area</dd><dt>Revision</dt><dd>{b.revision || 1}</dd></dl>
          </aside>
        </div>
      </article>
    </PublicFrame>
  );
}

export function PublicMapPage() {
  const [params,setParams]=useSearchParams();
  const { items, error, loading } = usePublicPosts({ limit: 100 });
  const points = items.filter((b) => b.lat != null && b.lng != null).map(bulletinMapPoint);
  return (
    <CommunityShell active="map" points={points}>
      <section className="rg-map-masthead rg-community-heading">
        <div><h1>Monitoring Map</h1></div>
        <img className="rg-map-page-mascot" src="/images/mascot/map-focused-v2.png" alt="RiceGuardAI field companion checking a map" />
      </section>
      <section className="rg-public-map-page">
        {error ? <HonestState title="The monitoring map is unavailable" text={error} /> : null}
        <FieldMap publicView large points={points} focusId={params.get("advisory") || undefined} />
        {params.get("advisory") && !loading && !points.some(point=>point.id===params.get("advisory")) ? <p role="status">This advisory has no approved public map pin. It may still appear in the bulletin.</p> : null}
          <div className="rg-map-summary"><MapPin size={18} /><span>{loading ? "Loading approved locations…" : publicMapSummary(points.length,groupMapPoints(points).length)}</span><Info size={17} /><small>Each post has its own pin. Shared locations may overlap; use Locate or choose a post in the popup.</small></div>
        <section className="rg-map-posts" aria-label="Published map areas"><h2>Updates on the map</h2><p>Select a post to find its location. Pins show approximate areas, not field boundaries.</p><ul className="rg-map-post-list">{points.map(point=><li key={point.id} className={params.get("advisory")===point.id?"selected":""}>
          <div><strong>{point.name}</strong><span>{point.location}</span></div><div className="rg-map-record-actions"><button type="button" className="rg-button rg-secondary" onClick={()=>setParams({advisory:point.id},{replace:true})}><MapPin size={16}/> Locate</button><Link className="rg-button rg-secondary" to={point.href || "/advisories"}>Read post <ArrowRight size={16}/></Link></div></li>)}</ul></section>
        {!loading && items.some(item=>item.lat==null||item.lng==null)?<p className="rg-map-unmapped">{items.filter(item=>item.lat==null||item.lng==null).length} published {items.filter(item=>item.lat==null||item.lng==null).length===1?'post has':'posts have'} no approved map pin. <Link to="/bulletin">Read all posts in the bulletin.</Link></p>:null}
      </section>
    </CommunityShell>
  );
}
