import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Info,
  MapPin,
  Menu,
  Plane,
  ScanLine,
  ShieldCheck,
  MessageSquareText,
  UploadCloud,
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
  Info as PhInfo,
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
import { FieldMap } from "./LazyMap";
import type { Bulletin, Disease } from "./domain";
import { AssistantWidget, BulletinWalkthrough, openRiceGuardAssistant } from "./Assistant";
import { useSmsRegistrationStatus } from "./registrationStatus";
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

type PublicPostRow = {
  id: string;
  slug: string;
  title: string;
  approximate_location: string;
  disease: Disease;
  assessment_label: Bulletin["severity"];
  summary: string;
  recommended_actions: string;
  limitations: string | null;
  published_at: string;
  updated_at: string;
  correction_note: string | null;
  media: Bulletin["media"] | null;
  cover_url: string | null;
  reviewer_name: string | null;
  approximate_lat: number | null;
  approximate_lng: number | null;
  revision: number;
};

function toBulletin(row: PublicPostRow): Bulletin {
  const media = Array.isArray(row.media) ? row.media : [];
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    location: row.approximate_location,
    disease: row.disease,
    severity: row.assessment_label,
    body: [row.summary, row.limitations].filter(Boolean).join("\n\n"),
    action: row.recommended_actions,
    date: row.published_at,
    status: "published",
    image: row.cover_url || media[0]?.url || "",
    media,
    reviewer: row.reviewer_name,
    lat: row.approximate_lat,
    lng: row.approximate_lng,
    published_at: row.published_at,
    updated_at: row.updated_at,
    revision: row.revision,
  };
}

function usePublicPosts(filters?: {
  disease?: string;
  location?: string;
  date?: string;
  limit?: number;
}) {
  const [items, setItems] = useState<Bulletin[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const limit = filters?.limit || 12;
  const filterKey = JSON.stringify(filters || {});

  const fetchPage = async (after?: string | null, append = false) => {
    if (!supabaseConfigured) {
      setItems([]);
      setError("We couldn't load field advisories right now. Please check back later.");
      setLoading(false);
      return;
    }
    setLoading(true);
    let query = supabase
      .from("rg_public_posts")
      .select("*")
      .order("published_at", { ascending: false })
      .limit(limit + 1);
    if (after) query = query.lt("published_at", after);
    if (filters?.disease && filters.disease !== "all")
      query = query.eq("disease", filters.disease);
    if (filters?.location)
      query = query.ilike("approximate_location", `%${filters.location}%`);
    if (filters?.date) query = query.gte("published_at", filters.date);
    const { data, error: fetchError } = await query;
    if (fetchError) {
      setError("Published advisories could not be loaded. Please try again.");
      setLoading(false);
      return;
    }
    const rows = (data || []) as PublicPostRow[];
    const page = rows.slice(0, limit).map(toBulletin);
    setItems((current) => (append ? [...current, ...page] : page));
    setHasMore(rows.length > limit);
    setCursor(page.at(-1)?.published_at || null);
    setError("");
    setLoading(false);
  };

  useEffect(() => {
    void fetchPage(null, false);
    // Filters are serialized so object identity does not refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  return {
    items,
    error,
    loading,
    hasMore,
    loadMore: () => fetchPage(cursor, true),
  };
}

function Hero() {
  return (
    <section className="rg-field-hero">
      <picture className="rg-field-hero-photo">
        <source
          type="image/avif"
          srcSet="/images/field-hero-960.avif 960w, /images/field-hero-1600.avif 1600w"
          sizes="100vw"
        />
        <source
          type="image/webp"
          srcSet="/images/field-hero-960.webp 960w, /images/field-hero-1600.webp 1600w, /images/field-hero-2560.webp 2560w"
          sizes="100vw"
        />
        <img
          src="/images/field-hero-2560.jpg"
          alt="Aerial view of rice fields in Region II under a cloudy sky"
          fetchPriority="high"
        />
      </picture>
      <div className="rg-field-hero-shade" />
      <div className="rg-field-hero-content">
        <div className="rg-field-hero-copy">
          <p className="rg-kicker"><span /> FIELD MONITORING · REGION II</p>
          <h1>A clearer picture of rice-field health.</h1>
          <p className="rg-field-hero-lead">
            Drone imagery helps our team examine Bacterial Leaf Blight and Brown Spot.
            Read the field updates and practical guidance we publish after review.
          </p>
          <div className="rg-field-hero-actions">
            <Link className="rg-button rg-hero-primary" to="/bulletin">
              View Field Advisories <ArrowRight size={18} />
            </Link>
            <Link className="rg-button rg-hero-secondary" to="/register">
              Get SMS alerts <MessageSquareText size={18} />
            </Link>
          </div>
        </div>
        <div className="rg-mascot-stage">
          <button className="rg-hero-mascot rg-wave-mascot" type="button" onClick={openRiceGuardAssistant} aria-label="Kausapin ang RiceGuardAI Assistant">
            <img src="/images/mascot/hero-wave-open-v2.png" alt="" aria-hidden="true" />
            <img src="/images/mascot/hero-wave-tilt-v2.png" alt="" aria-hidden="true" />
            <span className="rg-hero-speech">Mabuhay, ka-farmer! Ako ang RiceGuardAI Assistant. Pindutin ako para magtanong.</span>
          </button>
        </div>
      </div>
    </section>
  );
}

const workflow = [
  {
    icon: Plane,
    title: "Capture",
    text: "Record the field by drone.",
  },
  {
    icon: UploadCloud,
    title: "Upload",
    text: "Send the photos or video for analysis.",
  },
  {
    icon: ScanLine,
    title: "Analyze",
    text: "Look for BLB and Brown Spot in the imagery.",
  },
  {
    icon: CheckCircle2,
    title: "Share",
    text: "Publish the reviewed advisory and send nearby SMS alerts.",
  },
];

export function HomePage() {
  const { items, loading, error } = usePublicPosts({ limit: 3 });
  const previewVideo = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = previewVideo.current;
    if (!video) return;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) { video.pause(); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void video.play().catch(() => {});
      else video.pause();
    }, { threshold: .25 });
    observer.observe(video);
    return () => observer.disconnect();
  }, []);
  return (
    <PublicFrame>
      <Hero />
      <section className="rg-home-section rg-home-latest">
        <SectionTitle
          eyebrow="LATEST FIELD INFORMATION"
          title="Reviewed advisories, published with context."
          action={<Link to="/bulletin">Open bulletin <ArrowRight size={16} /></Link>}
        />
        {error && <HonestState title="Field updates are temporarily out of reach" text={error} />}
        {loading ? (
          <div className="rg-feed-skeleton" aria-label="Loading advisories"><i /><i /><i /></div>
        ) : items.length ? (
          <div className="rg-home-posts">{items.map((item) => <BulletinCard key={item.id} item={item} />)}</div>
        ) : !error ? (
          <HonestState
            title="No published advisories yet"
            text="Only approved field findings appear here. An empty bulletin is not proof that fields are disease-free."
          />
        ) : null}
      </section>

      <section className="rg-home-section rg-workflow-section">
        <SectionTitle
          eyebrow="HOW IT WORKS"
          title="From field visit to useful update."
        />
        <div className="rg-workflow-rail" role="region" aria-label="Capture to advisory steps" tabIndex={0}>
          {workflow.map((step, index) => (
            <article key={step.title}>
              <span className="rg-workflow-index">0{index + 1}</span>
              <step.icon size={24} />
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              {index === 2 ? <img className="rg-workflow-mascot" src="/images/mascot/leaf-review-v2.png" alt="Field companion examining a rice leaf" loading="lazy" /> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="rg-home-section rg-video-section" aria-labelledby="rg-video-title">
        <div className="rg-video-intro">
          <p className="rg-kicker dark"><span /> FIELD VIDEO</p>
          <h2 id="rg-video-title">Watch BLB detection on field footage.</h2>
          <p>Experimental BLB candidate overlays on drone footage. Field review is still required.</p>
        </div>
        <div className="rg-video-frame">
          <video
            ref={previewVideo}
            autoPlay
            muted
            loop
            playsInline
            disablePictureInPicture
            controlsList="nodownload noremoteplayback noplaybackrate"
            preload="metadata"
            poster="/video/blb-prototype-poster.jpg"
            aria-label="Thirty-second field video highlighting Bacterial Leaf Blight candidates"
          >
            <source src="/video/blb-prototype-preview.mp4" type="video/mp4" />
            Your browser cannot play this video.
          </video>
        </div>
      </section>

      <section className="rg-home-section rg-map-feature">
        <div>
          <p className="rg-kicker dark"><span /> PUBLIC MONITORING MAP</p>
          <h2>See where field updates come from.</h2>
          <p>
            Browse published updates across Region II. Map markers show general
            survey areas, while exact farm details stay private.
          </p>
          <Link className="rg-button rg-primary" to="/map">
            Explore the map <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="rg-home-map-shell">
          <FieldMap
            publicView
            points={items
              .filter((b) => b.lat != null && b.lng != null)
              .map((b) => ({ id: b.id, lat: b.lat!, lng: b.lng!, name: b.title, severity: b.severity }))}
          />
        </div>
      </section>

      <section className="rg-home-section rg-disease-section">
        <SectionTitle
          eyebrow="WHAT WE LOOK FOR"
          title="Focused on two rice-leaf diseases."
        />
        <div className="rg-disease-grid">
          <article>
            <span className="rg-disease-code">01</span>
            <h3>Bacterial Leaf Blight</h3>
            <p>Our team reviews images for leaf areas that may show Bacterial Leaf Blight symptoms.</p>
          </article>
          <article>
            <span className="rg-disease-code">02</span>
            <h3>Brown Spot</h3>
            <p>We review leaves with possible Brown Spot symptoms. A marked leaf can include healthy green tissue.</p>
          </article>
          <article className="rg-calibration-card">
            <ShieldCheck size={28} />
            <h3>Field checks still matter</h3>
            <p>Images can guide an inspection, but they cannot confirm a field diagnosis or determine severity on their own.</p>
          </article>
        </div>
      </section>

      <section className="rg-sms-cta">
        <div className="rg-sms-scene">
          <img className="rg-sms-mascot" src="/images/mascot/sms-focused-v2.png" alt="RiceGuardAI field companion looking at a phone" loading="lazy" />
          <span className="rg-sms-popup" aria-label="Illustrative SMS notification">
            <MessageSquareText size={15} aria-hidden="true" />
            <strong>RiceGuardAI field alerts</strong>
          </span>
        </div>
        <div>
          <p className="rg-kicker"><span /> SMS FIELD ALERTS</p>
          <h2>Field updates by text, when they matter nearby.</h2>
          <p>Register your farm and mobile number to receive relevant, reviewed updates by text.</p>
        </div>
        <Link className="rg-button rg-hero-primary" to="/register">
          Get SMS alerts <MessageSquareText size={18} />
        </Link>
      </section>
    </PublicFrame>
  );
}

function SectionTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="rg-home-heading">
      <div><p className="rg-kicker dark"><span /> {eyebrow}</p><h2>{title}</h2></div>
      {action}
    </div>
  );
}

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
    ? item.media.filter((entry) => entry.type === "image").slice(0, 2)
    : item.image
      ? [{ url: item.image, alt: `Approved public preview for ${item.title}`, type: "image" as const }]
      : [];
  const [summary, ...limitationParts] = item.body.split("\n\n").filter(Boolean);
  const limitation = limitationParts.join(" ") || "This reviewed advisory describes an approximate monitored area. Field verification remains required.";
  const corrected = Boolean(item.revision && item.revision > 1) || Boolean(
    item.updated_at && item.published_at && item.updated_at !== item.published_at,
  );
  const share = async () => {
    const url = `${location.origin}/advisories/${item.slug}`;
    if (navigator.share) await navigator.share({ title: item.title, url });
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
          <span className={`rg-disease-pill ${item.disease === "BLB" ? "blb" : "brown"}`}>
            {item.disease === "BLB" ? "Bacterial Leaf Blight" : "Brown Spot"}
          </span>
          <span className="rg-reviewed-pill"><PhCheckCircle size={14} weight="fill" /> Reviewed</span>
          {corrected ? <span className="rg-updated-pill">Updated</span> : null}
        </div>
      </div>

      <div className={`rg-bulletin-post-body ${media.length > 1 ? "has-gallery" : ""}`}>
        <div className="rg-post-narrative">
          <h2><Link to={`/advisories/${item.slug}`}>{item.title}</Link></h2>
          <p className="rg-post-summary">{summary}</p>
          <div className="rg-post-recommendation">
            <PhSprout size={20} weight="bold" />
            <div><strong>Recommended action</strong><p>{item.action}</p></div>
          </div>
          <p className="rg-post-limitation"><PhInfo size={17} weight="fill" /> {limitation}</p>
        </div>
        {media.length ? (
          <Link to={`/advisories/${item.slug}`} className="rg-bulletin-media" aria-label={`Open ${item.title}`}>
            {media.map((entry, index) => (
              <img key={`${entry.url}-${index}`} src={entry.url} alt={entry.alt} loading="lazy" />
            ))}
          </Link>
        ) : null}
      </div>

      <footer className="rg-bulletin-post-actions">
        <Link to={`/advisories/${item.slug}`}>View details <ArrowRight size={15} /></Link>
        <button onClick={() => toggle(item.id)} aria-pressed={bookmarked}>
          <PhBookmark size={20} weight={bookmarked ? "fill" : "regular"} />
          <span>{bookmarked ? "Saved" : "Save"}</span>
        </button>
        <button onClick={() => void share()}><PhShare size={20} /><span>Share</span></button>
      </footer>
    </article>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function assessmentLabel(value: Bulletin["severity"]) {
  if (value === "not_calibrated" || value === "unknown") return "Severity not yet calibrated";
  return `${value[0].toUpperCase()}${value.slice(1)} severity`;
}

type CommunityPage = "bulletin" | "map" | "sms";
type CommunityPoints = ComponentProps<typeof FieldMap>["points"];

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
          <nav>
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

        <nav className="rg-bulletin-mobile-nav" aria-label="Mobile public navigation">
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
    .map((item) => ({ id: item.id, lat: item.lat!, lng: item.lng!, name: item.title, severity: item.severity }));

  return (
    <CommunityShell active="bulletin" points={mapPoints} savedSelected={bookmarkedOnly} onToggleSaved={() => setBookmarkedOnly(!bookmarkedOnly)}>
          <BulletinWalkthrough />
          <header className="rg-social-bulletin-heading">
            <h1>Field Bulletin</h1>
            <img src="/images/mascot/bulletin-reader-v2.png" alt="RiceGuardAI field companion reading a field bulletin" />
          </header>

          <section className="rg-bulletin-filter-bar" aria-label="Filter advisories">
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
          <section className="rg-social-feed" aria-live="polite">
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
          <div><span className="rg-badge">{b.disease}</span><span className="rg-reviewed"><CheckCircle2 size={15} /> Reviewed publication</span></div>
          <h1>{b.title}</h1>
          <p><MapPin size={17} /> {b.location}<Clock3 size={16} /> Published {formatDate(b.published_at || b.date)}</p>
          {corrected ? <div className="rg-correction">Updated {formatDate(b.updated_at!)} · Revision {b.revision}</div> : null}
        </header>
        {b.image ? <img className="rg-advisory-cover" src={b.image} alt={`Public preview for ${b.title}`} /> : null}
        <div className="rg-advisory-body">
          <section><h2>Reviewed finding</h2>{b.body.split("\n\n").map((text) => <p key={text}>{text}</p>)}<h2>Recommended actions</h2><p>{b.action}</p></section>
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
  const { items, error, loading } = usePublicPosts({ limit: 100 });
  const points = items.filter((b) => b.lat != null && b.lng != null).map((b) => ({ id: b.id, lat: b.lat!, lng: b.lng!, name: b.title, severity: b.severity }));
  return (
    <CommunityShell active="map" points={points}>
      <section className="rg-map-masthead rg-community-heading">
        <div><h1>Monitoring Map</h1></div>
        <img className="rg-map-page-mascot" src="/images/mascot/map-focused-v2.png" alt="RiceGuardAI field companion checking a map" />
      </section>
      <section className="rg-public-map-page">
        {error ? <HonestState title="The monitoring map is unavailable" text={error} /> : null}
        <FieldMap publicView large points={points} />
        <div className="rg-map-summary"><MapPin size={18} /><span>{loading ? "Loading approved locations…" : points.length ? `${points.length} published advisory areas` : "No approved public locations yet."}</span><Info size={17} /><small>Map background alone is not a current disease observation.</small></div>
      </section>
    </CommunityShell>
  );
}
