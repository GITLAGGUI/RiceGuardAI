import {
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Link, NavLink, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  ChevronDown,
  CloudRain,
  Droplets,
  Info,
  HelpCircle,
  MapPin,
  Menu,
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
  ChatCircleText as PhChat,
  House as PhHouse,
  MapPin as PhMapPin,
  MapTrifold as PhMap,
  MagnifyingGlass as PhSearch,
  ShieldCheck as PhShield,
  SlidersHorizontal as PhFilters,
  X as PhX,
} from "@phosphor-icons/react";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { bulletinMapPoint, toBulletin, usePublicPosts, type PublicPostRow } from "./publicPosts";
import { FieldMap } from "./LazyMap";
import { groupMapPoints, publicMapSummary } from "./mapPoints";
import type { Bulletin } from "./domain";
import { AssistantWidget, BulletinWalkthrough, openBulletinWalkthrough } from "./Assistant";
import { AdvisoryDetail, BulletinCard, useBookmarks } from "./BulletinPost";
import { useSmsRegistrationStatus } from "./registrationStatus";
import { weatherForBulletin, type BulletinWeather } from "./weatherPresentation";
import { WeatherLocation } from "./WeatherLocation";
import "./operations.css";
import "./bulletin.css";
import "./bulletin-feed.css";
import "./fit-pages.css";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link to="/" className={`rg-brand ${light ? "light" : ""}`}>
      <span><img src="/images/mascot/field-companion-192.webp" alt="" /></span>
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
            <div><h2>Paano ito gumagana</h2><p>Awtomatikong sinusuri ng AI ang bawat upload at agad itong ipino-post. Ang may <b>?</b> ay hindi pa nave-verify ng specialist.</p></div>
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
            <img src="/images/mascot/bulletin-reader-v2.png" alt="" />
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
            <strong>{visible.length} {visible.length === 1 ? "advisory" : "advisories"}</strong>
            <span>Pinakabago muna</span>
          </div>
          <section className="rg-feed3" aria-live="polite" data-tour="feed">
            {error && <HonestState title="The bulletin is unavailable" text={error} />}
            {loading && !items.length ? <div className="rg-feed-skeleton"><i /><i /><i /></div> : null}
            {visible.map((item) => <BulletinCard key={item.id} item={item} />)}
            {!loading && !visible.length && !error ? <HonestState title="Walang tugmang advisory" text="Subukang alisin ang mga filter." /> : null}
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
  const { item, loading, error } = useAdvisory(slug);
  return (
    <PublicFrame>
      {item ? <AdvisoryDetail item={item} /> : (
        <div className="rg-advisory-state">
          <HonestState title={loading ? "Binubuksan ang payo" : "Hindi mahanap ang payo"} text={loading ? "Sandali lang…" : error} />
          <Link to="/bulletin">Bumalik sa bulletin</Link>
        </div>
      )}
    </PublicFrame>
  );
}

export function PublicMapPage() {
  const [params,setParams]=useSearchParams();
  const { items, error, loading } = usePublicPosts({ limit: 100 });
  const points = items.filter((b) => b.lat != null && b.lng != null).map(bulletinMapPoint);
  const unmapped = items.filter((item) => item.lat == null || item.lng == null).length;
  const selected = params.get("advisory");
  return (
    <CommunityShell active="map" points={points}>
      <section className="rg-mapfit" aria-labelledby="rg-mapfit-title">
        <header className="rg-mapfit-head">
          <img src="/images/mascot/map-focused-v2.png" alt="" width={44} height={44} />
          <div>
            <h1 id="rg-mapfit-title">Monitoring Map</h1>
            <p><MapPin size={14} aria-hidden /> {loading ? "Loading approved locations…" : publicMapSummary(points.length, groupMapPoints(points).length)}</p>
          </div>
        </header>
        {error ? <HonestState title="The monitoring map is unavailable" text={error} /> : null}
        <div className="rg-mapfit-body">
          <div className="rg-mapfit-map">
            <FieldMap publicView large points={points} focusId={selected || undefined} />
            {selected && !loading && !points.some((point) => point.id === selected)
              ? <p className="rg-mapfit-toast" role="status">This advisory has no approved public map pin. It may still appear in the bulletin.</p> : null}
          </div>
          <section className="rg-mapfit-list" aria-label="Published map areas">
            <h2>Updates on the map <span>{points.length}</span></h2>
            <p><Info size={14} aria-hidden /> Pins show approximate areas, not field boundaries. Shared locations may overlap.</p>
            <ul>{points.map((point) => (
              <li key={point.id} className={selected === point.id ? "selected" : ""}>
                <button type="button" className="rg-mapfit-locate" onClick={() => setParams({ advisory: point.id }, { replace: true })}>
                  <strong>{point.name}</strong><span>{point.location}</span>
                </button>
                <Link to={point.href || "/advisories"} aria-label={`Read post: ${point.name}`}>Read <ArrowRight size={14} /></Link>
              </li>))}
            </ul>
            {!loading && unmapped ? <p className="rg-mapfit-unmapped">{unmapped} published {unmapped === 1 ? "post has" : "posts have"} no approved map pin. <Link to="/bulletin">Read them in the bulletin.</Link></p> : null}
          </section>
        </div>
      </section>
    </CommunityShell>
  );
}
