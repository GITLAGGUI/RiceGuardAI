import { Component, lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Check, MapPin, Menu, MessageSquareText, Play, ScanLine, ShieldCheck, Volume2, X } from "lucide-react";
import { AssistantWidget } from "../Assistant";
import { useSmsRegistrationStatus } from "../registrationStatus";
import { bulletinMapPoint, usePublicPosts } from "../publicPosts";
import { FieldMap } from "../LazyMap";
import { VerificationBadge } from "../VerificationBadge";
import { reviewedDiseaseLabel } from "../advisoryPresentation";
import type { Bulletin } from "../domain";
import { useSmoothScroll } from "@/components/motion/useSmoothScroll";
import { heroInput } from "./heroInput";
import { HeroMascot } from "./HeroMascot";
import { HeroSky } from "./HeroSky";
import "../operations.css";
import "./landing.css";
import "./landing-v4.css";
import "./hero-v5.css";

const RiceField3D = lazy(() => import("./RiceField3D"));

/** If WebGL or the 3D chunk fails, the hero keeps its photograph instead of taking the page down. */
class SceneBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? (this.props.fallback ?? null) : this.props.children; }
}

const FILM_SRC = "/video/riceguardai-film-v2.mp4";
const FILM_POSTER = "/video/riceguardai-film-v2-poster.jpg";

const vars = (values: Record<string, string | number>) => values as CSSProperties;

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * `[data-reveal]` gets `is-in` once, when it first enters the viewport (entrances).
 * `[data-live]` toggles `is-live` while on screen, so looping micro-animations only run when seen.
 */
function useViewportClasses(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const scope = root.current;
    if (!scope) return;
    const reveals = [...scope.querySelectorAll<HTMLElement>("[data-reveal]")];
    const lives = [...scope.querySelectorAll<HTMLElement>("[data-live]")];
    if (!("IntersectionObserver" in window)) {
      reveals.forEach((node) => node.classList.add("is-in"));
      lives.forEach((node) => node.classList.add("is-live"));
      return;
    }
    const reveal = new IntersectionObserver(
      (entries) => entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        reveal.unobserve(entry.target);
      }),
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    const live = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.target.classList.toggle("is-live", entry.isIntersecting)),
      { threshold: 0.15 },
    );
    reveals.forEach((node) => reveal.observe(node));
    lives.forEach((node) => live.observe(node));
    return () => {
      reveal.disconnect();
      live.disconnect();
    };
  }, [root]);
}

/** True once the element is within `margin` of the viewport; used to defer heavy widgets. */
/**
 * `[data-parallax="0.1"]` drifts against the scroll by that fraction of its distance from the
 * viewport centre. It writes the `translate` property, so hover transforms still compose.
 */
function useParallax(root: React.RefObject<HTMLElement | null>) {
  const reduced = useReducedMotion();
  useEffect(() => {
    const scope = root.current;
    if (!scope || reduced) return;
    const nodes = [...scope.querySelectorAll<HTMLElement>("[data-parallax]")];
    let frame = 0;
    const apply = () => {
      frame = 0;
      const middle = window.innerHeight / 2;
      for (const node of nodes) {
        const box = (node.parentElement || node).getBoundingClientRect();
        if (box.bottom < -200 || box.top > window.innerHeight + 200) continue;
        const speed = Number(node.dataset.parallax) || 0.08;
        const offset = box.top + box.height / 2 - middle;
        node.style.translate = `0 ${(-offset * speed).toFixed(1)}px`;
      }
    };
    const request = () => { if (!frame) frame = requestAnimationFrame(apply); };
    apply();
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", request); window.removeEventListener("resize", request); };
  }, [root, reduced]);
}

function useNearViewport<T extends HTMLElement>(margin = "600px") {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || near) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setNear(true); observer.disconnect(); }
    }, { rootMargin: margin });
    observer.observe(node);
    return () => observer.disconnect();
  }, [margin, near]);
  return [ref, near] as const;
}

function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <Link to="/" className={`lp-wordmark ${light ? "is-light" : ""}`} aria-label="RiceGuardAI home">
      <img src="/images/mascot/field-companion.png" alt="" width="40" height="40" />
      <span>RiceGuard<b>AI</b></span>
    </Link>
  );
}

function LandingHeader({ smsPath, smsLabel }: { smsPath: string; smsLabel: string }) {
  const [solid, setSolid] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let frame = 0;
    let lastY = window.scrollY;
    // Scrolling down tucks the header away; any scroll up brings it back. Small jitters are ignored.
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        setSolid(y > 40);
        if (y < 120) setHidden(false);
        else if (y > lastY + 6) setHidden(true);
        else if (y < lastY - 6) setHidden(false);
        if (Math.abs(y - lastY) > 6 || y < 120) lastY = y;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", onScroll); };
  }, []);
  const close = () => setOpen(false);
  return (
    <header className={`lp-header ${solid || open ? "is-solid" : ""} ${hidden && !open ? "is-hidden" : ""}`}>
      <Wordmark light={!solid && !open} />
      <nav className={open ? "is-open" : ""} aria-label="Main navigation">
        <a href="#how" onClick={close}>How it works</a>
        <Link to="/bulletin" onClick={close}>Field advisories</Link>
        <Link to="/map" onClick={close}>Monitoring map</Link>
        <a href="#film" onClick={close}>Watch the film</a>
        <Link to={smsPath} onClick={close} className="lp-nav-sms">{smsLabel}</Link>
      </nav>
      <div className="lp-header-actions">
        <Link className="lp-button" to={smsPath}>{smsLabel}</Link>
        <button className="lp-menu-button" type="button" aria-expanded={open} aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)}>
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
    </header>
  );
}

function Hero({ latest, smsPath, smsLabel }: { latest?: Bulletin; smsPath: string; smsLabel: string }) {
  const section = useRef<HTMLElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(true);
  const [show3D, setShow3D] = useState(false);
  const [narrow] = useState(() => window.innerWidth < 760);

  useEffect(() => {
    // Mount the scene after the boot loader has gone so it never competes with first paint.
    const start = () => {
      const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
      if (idle) idle(() => setShow3D(true), { timeout: 600 });
      else window.setTimeout(() => setShow3D(true), 200);
    };
    if (document.documentElement.classList.contains("rg-app-ready")) { start(); return; }
    const observer = new MutationObserver(() => {
      if (document.documentElement.classList.contains("rg-app-ready")) { observer.disconnect(); start(); }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = section.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(node);
    let frame = 0;
    // Write transforms straight onto the two layers; no inherited CSS variables, no React renders.
    const apply = () => {
      frame = 0;
      const height = node.offsetHeight || 1;
      const p = reduced ? 0 : Math.min(1, Math.max(0, window.scrollY / height));
      heroInput.scroll = p;
      node.closest(".lp")?.classList.toggle("is-past-hero", p > 0.55);
      if (p >= 1) return;
      if (copy.current) {
        copy.current.style.transform = `translate3d(0, ${(p * height * -0.12).toFixed(1)}px, 0)`;
        copy.current.style.opacity = String(Math.max(0, 1 - p * 1.5).toFixed(3));
      }
    };
    const request = () => { if (!frame) frame = requestAnimationFrame(apply); };
    const onPointer = (event: PointerEvent) => {
      if (reduced || event.pointerType === "touch") return;
      heroInput.x = (event.clientX / window.innerWidth) * 2 - 1;
      heroInput.y = (event.clientY / window.innerHeight) * 2 - 1;
      heroInput.moved = performance.now();
      if (window.scrollY < node.offsetHeight) request();
    };
    apply();
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("pointermove", onPointer, { passive: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", request);
      window.removeEventListener("pointermove", onPointer);
    };
  }, [reduced]);

  const latestImage = latest?.media?.find((entry) => entry.type === "image")?.url || latest?.image;
  const headline = [["Catch", "rice", "disease"], ["before", "it", "spreads."]];
  let wordIndex = 0;
  return (
    <section className="lp-hero" ref={section} aria-labelledby="lp-hero-title">
      <HeroSky paused={!visible || reduced} />
      <div className="lp-hero-stage" aria-hidden="true">
        {show3D ? (
          <SceneBoundary fallback={<img className="lp-hero-fallback" src="/images/field-hero-1600.webp" alt="" />}>
            <Suspense fallback={null}>
              <RiceField3D paused={!visible || reduced} density={narrow ? 0.4 : 1} narrow={narrow} />
            </Suspense>
          </SceneBoundary>
        ) : null}
        <div className="lp-hero-horizon" />
      </div>
      <div className="lp-hero-scrim" aria-hidden="true" />
      <HeroMascot active={show3D && !reduced} />
      <div className="lp-hero-copy" ref={copy}>
        <h1 id="lp-hero-title">
          {headline.map((line, lineIndex) => (
            <span key={lineIndex} className="lp-line">
              {line.map((word) => {
                const index = wordIndex++;
                return <span key={word} className={`lp-word ${word === "spreads." ? "is-accent" : ""}`} style={vars({ "--i": index })}>{word}</span>;
              })}
            </span>
          ))}
        </h1>
        <p className="lp-hero-lead">
          RiceGuardAI reads drone photos of Region II paddies for Bacterial Leaf Blight and Brown Spot,
          grades how bad it is, and texts nearby farmers what to do within minutes.
        </p>
        <div className="lp-hero-actions">
          <Link className="lp-button lp-button-lg" to={smsPath}>{smsLabel} <MessageSquareText size={18} /></Link>
          <a className="lp-ghost" href="#film"><span><Play size={15} fill="currentColor" /></span> Watch the film</a>
        </div>
      </div>
      <div className="lp-hero-bottom">
        <a className="lp-scroll-cue" href="#problem" aria-label="Scroll to learn more"><i /></a>
        <Link to={latest ? `/advisories/${latest.slug}` : "/bulletin"} className="lp-hero-card">
          <img src={latestImage || "/images/field/compare-detected-960.webp"} alt="" width="96" height="72" loading="lazy" />
          <span><small>{latest ? "Latest advisory" : "Field bulletin"}</small>{latest ? latest.title : "Read reviewed advisories"}</span>
          <ArrowUpRight size={18} />
        </Link>
      </div>
    </section>
  );
}

function Ticker() {
  const items = ["Batanes", "Cagayan", "Isabela", "Nueva Vizcaya", "Quirino", "Bacterial Leaf Blight", "Brown Spot", "Automatic advisories", "SMS alerts"];
  const row = (hidden: boolean) => (
    <div className="lp-ticker-row" aria-hidden={hidden || undefined}>
      {items.map((item) => <span key={item}>{item}<i /></span>)}
    </div>
  );
  return (
    <div className="lp-ticker" role="region" aria-label="Coverage and focus">
      <div className="lp-ticker-track">{row(false)}{row(true)}</div>
    </div>
  );
}

function TiltCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  const card = useRef<HTMLDivElement>(null);
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || !card.current) return;
    const box = card.current.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    card.current.style.transform = `perspective(900px) rotateY(${(x * 10).toFixed(2)}deg) rotateX(${(-y * 10).toFixed(2)}deg) translateZ(0)`;
    card.current.style.setProperty("--gx", `${((x + 0.5) * 100).toFixed(1)}%`);
    card.current.style.setProperty("--gy", `${((y + 0.5) * 100).toFixed(1)}%`);
  };
  const onLeave = () => { if (card.current) card.current.style.transform = ""; };
  return <div ref={card} className={`lp-tilt ${className}`} onPointerMove={onMove} onPointerLeave={onLeave}>{children}</div>;
}

function ProblemSection() {
  const statement = "BLB and Brown Spot start as a few streaks on scattered leaves. By the time they show from the dike, they have spread.";
  const words = statement.split(" ");
  return (
    <section className="lp-section lp-problem" id="problem" aria-labelledby="lp-problem-title">
      <h2 id="lp-problem-title" className="lp-eyebrow-title" data-reveal>The trouble starts small</h2>
      <p className="lp-statement">
        {words.map((word, index) => <span key={`${word}-${index}`} style={vars({ "--w": index / words.length })}>{word} </span>)}
      </p>
      <div className="lp-plight" data-reveal data-live>
        <TiltCard className="lp-pcard is-blb">
          <figure>
            <img src="/images/field/v2/blb-closeup.webp" alt="Rice leaves with yellow streaks running down from the tips" width="800" height="1000" loading="lazy" decoding="async" />
            <img className="lp-pcard-mask" src="/images/field/v2/blb-closeup-mask.webp" alt="" width="800" height="1000" loading="lazy" decoding="async" />
          </figure>
          <span className="lp-pcard-chip"><i /> Model view</span>
          <div>
            <span className="lp-pill">Bacterial Leaf Blight</span>
            <h3>Streaks that start at the tip</h3>
            <p>Wavy yellow stripes run down the leaf edge and dry out the blade. Yellow is every pixel the model marks.</p>
          </div>
        </TiltCard>
        <TiltCard className="lp-pcard is-bs">
          <figure>
            <img src="/images/field/v2/brownspot-macro.webp" alt="A rice leaf with oval brown lesions" width="1280" height="800" loading="lazy" decoding="async" />
            <img className="lp-pcard-mask" src="/images/field/v2/brownspot-macro-mask.webp" alt="" width="1280" height="800" loading="lazy" decoding="async" />
          </figure>
          <span className="lp-pcard-chip"><i /> Model view</span>
          <div>
            <span className="lp-pill">Brown Spot</span>
            <h3>Specks that multiply</h3>
            <p>Oval brown lesions with pale centres. Red marks each lesion, not the whole leaf.</p>
          </div>
        </TiltCard>
        <div className="lp-pcard is-farm">
          <figure><img src="/images/field/v2/farmers-irri.webp" alt="Two farmers bent over a flooded paddy inspecting rice by hand" width="1200" height="900" loading="lazy" decoding="async" /></figure>
          <div>
            <ScanLine size={22} />
            <h3>Too many hectares to walk</h3>
            <p>Five provinces, thousands of paddies, checked by hand under the sun. A drone covers in minutes what takes a day on foot.</p>
            <a className="lp-text-link" href="#see">See what the drone sees <ArrowRight size={16} /></a>
          </div>
        </div>
      </div>
      <p className="lp-credits">Photos: Brown Spot, Donald Groth, LSU AgCenter (CC BY 3.0) · farmers, IRRI (CC BY 2.0)</p>
    </section>
  );
}

function CompareSlider() {
  const [value, setValue] = useState(50);
  const [touched, setTouched] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const setFromPointer = (clientX: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box) return;
    setValue(Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100)));
  };
  return (
    <div
      className={`lp-compare ${touched ? "is-touched" : ""}`}
      ref={frame}
      data-live
      style={vars({ "--split": `${value}%` })}
      onPointerDown={(event) => { dragging.current = true; setTouched(true); event.currentTarget.setPointerCapture(event.pointerId); setFromPointer(event.clientX); }}
      onPointerMove={(event) => { if (dragging.current) setFromPointer(event.clientX); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
    >
      <img src="/images/field/latest-original-1600.webp" srcSet="/images/field/latest-original-960.webp 960w, /images/field/latest-original-1600.webp 1600w" sizes="(max-width: 900px) 100vw, 64vw" alt="Top-down drone photo of a flooded rice paddy before analysis" width="1600" height="900" loading="lazy" decoding="async" draggable={false} />
      <img className="lp-compare-top" src="/images/field/latest-detected-1600.webp" srcSet="/images/field/latest-detected-960.webp 960w, /images/field/latest-detected-1600.webp 1600w" sizes="(max-width: 900px) 100vw, 64vw" alt="The same photo with Bacterial Leaf Blight lesions painted yellow by the model" width="1600" height="900" loading="lazy" decoding="async" draggable={false} />
      <span className="lp-compare-sweep" aria-hidden="true" />
      <span className="lp-compare-tag is-left">Model view</span>
      <span className="lp-compare-tag is-right">Original photo</span>
      <span className="lp-compare-handle" aria-hidden="true"><i /></span>
      <span className="lp-compare-hint" aria-hidden="true">Drag to compare</span>
      <input type="range" min={0} max={100} value={Math.round(value)} onChange={(event) => { setTouched(true); setValue(Number(event.target.value)); }} aria-label="Reveal the model view over the original photo" />
    </div>
  );
}

function SeeSection() {
  return (
    <section className="lp-see" id="see" aria-labelledby="lp-see-title">
      <div className="lp-see-inner">
        <div className="lp-see-copy" data-reveal>
                    <h2 id="lp-see-title">See what the models see</h2>
          <p>Drag across a real drone photo from our latest field test in Poblacion 1, Santa Maria, Isabela. Every yellow mark is a pixel the Bacterial Leaf Blight model flagged, later confirmed by a specialist.</p>
          <ul className="lp-see-facts">
            <li><strong>6.2%</strong> of the leaf area hit, IRRI SES 3</li>
            <li><strong>Minutes</strong> from upload to a published advisory</li>
            <li><strong>Every</strong> mark open for a specialist to check</li>
          </ul>
        </div>
        <div className="lp-see-frame" data-reveal><div data-parallax="0.04"><CompareSlider /></div></div>
      </div>
    </section>
  );
}

function HowSection() {
  const checks = ["Worst photo found", "Leaf area measured", "IRRI scale applied", "Sources searched", "Barangay named"];
  return (
    <section className="lp-section lp-how" id="how" aria-labelledby="lp-how-title">
      <div className="lp-section-head" data-reveal>
        <h2 id="lp-how-title">From one flight to one text</h2>
        <p>Four steps that run on their own, in minutes. A specialist checks every finding afterwards, and a wrong alert is corrected by text.</p>
      </div>
      <div className="lp-bento" data-reveal>
        <article className="lp-card lp-card-capture" data-live>
          <div className="lp-card-media">
            <img data-parallax="0.07" src="/images/field/paddy-water-1600.webp" srcSet="/images/field/paddy-water-960.webp 960w, /images/field/paddy-water-1600.webp 1600w" sizes="(max-width: 860px) 100vw, 60vw" alt="Young rice plants in a flooded paddy, photographed from above" width="1600" height="900" loading="lazy" decoding="async" />
            <span className="lp-scanline" aria-hidden="true" />
            <span className="lp-brackets" aria-hidden="true"><i /><i /><i /><i /></span>
            <span className="lp-gps" aria-hidden="true"><MapPin size={14} /> GPS + time read from the photo</span>
          </div>
          <div className="lp-card-body"><span className="lp-step">Step 1 · Capture</span><h3>A drone flies low over the paddy</h3><p>Full-resolution photos, each tied to its field by the time and GPS in the file.</p></div>
        </article>
        <article className="lp-card lp-card-detect" data-live>
          <div className="lp-card-media">
            <img data-parallax="0.07" src="/images/field/leaf-polygons-960.webp" alt="Rice leaves outlined one by one by the models" width="960" height="540" loading="lazy" decoding="async" />
            <span className="lp-model-chips" aria-hidden="true"><b>BLB</b><b>Brown Spot</b></span>
          </div>
          <div className="lp-card-body"><span className="lp-step">Step 2 · Detect</span><h3>Two models, one photo</h3><p>Each model marks only its own disease, so one finding never hides the other.</p></div>
        </article>
        <article className="lp-card lp-card-review" data-live>
          <div className="lp-review-ui" aria-hidden="true">
            <div className="lp-review-head"><ShieldCheck size={16} /> Automatic checks</div>
            <ul>{checks.map((check, index) => <li key={check} style={vars({ "--k": index })}><span><Check size={13} strokeWidth={3} /></span>{check}</li>)}</ul>
            <div className="lp-stamp">Ready</div>
          </div>
          <div className="lp-card-body"><span className="lp-step">Step 3 · Grade and advise</span><h3>Severity, place and advice</h3><p>The most affected photo is graded on the IRRI scale, and the AI writes the advice from IRRI and PhilRice sources.</p></div>
        </article>
        <article className="lp-card lp-card-publish" data-live>
          <div className="lp-publish-ui" aria-hidden="true">
            <div className="lp-mini-bulletin">
              <img src="/images/field/disease-blb-800.webp" alt="" width="800" height="1000" loading="lazy" />
              <div><span className="lp-pill">?</span><strong>BLB advisory · Cagayan</strong><small>Walk the marked area and check the leaf tips.</small></div>
            </div>
            <div className="lp-mini-sms"><MessageSquareText size={16} /><span><b>RiceGuardAI</b> BLB advisory near your field. Details: riceguardai.dev</span></div>
            <span className="lp-mini-pin"><MapPin size={18} /></span>
          </div>
          <div className="lp-card-body"><span className="lp-step">Step 4 · Publish</span><h3>Bulletin, map and SMS</h3><p>The post goes up with a ? until a specialist confirms it, and farmers registered within 3 km get a text.</p></div>
        </article>
      </div>
    </section>
  );
}

function useFilmAvailable() {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(FILM_SRC, { method: "HEAD" })
      .then((response) => alive && setAvailable(response.ok && (response.headers.get("content-type") || "").startsWith("video/")))
      .catch(() => alive && setAvailable(false));
    return () => { alive = false; };
  }, []);
  return available;
}

/**
 * The film plays by itself while at least half of it is on screen and pauses the moment it leaves
 * (scrolling away, switching tabs or pages). There are no controls to pause or scrub. Browsers only
 * allow sound after the visitor has interacted with the page, so it may start muted with a sound button.
 */
function FilmSection() {
  const hasFilm = useFilmAvailable();
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(false);
  const src = hasFilm ? FILM_SRC : "/video/blb-prototype-preview.mp4";
  const poster = hasFilm ? FILM_POSTER : "/video/blb-prototype-poster.jpg";

  useEffect(() => {
    const node = frame.current, el = video.current;
    if (!node || !el) return;
    let inView = false;
    const play = async () => {
      if (!inView || document.hidden) return;
      if (el.ended) el.currentTime = 0;
      try {
        await el.play();
      } catch {
        // Sound needs a user gesture first: fall back to muted playback.
        el.muted = true;
        setMuted(true);
        await el.play().catch(() => undefined);
      }
    };
    const update = () => { if (inView && !document.hidden) void play(); else el.pause(); };
    const observer = new IntersectionObserver(([entry]) => { inView = entry.intersectionRatio >= 0.5; update(); }, { threshold: [0, 0.5, 1] });
    observer.observe(node);
    // The first click or key press anywhere grants sound; turn it back on if we had to mute.
    const grant = () => { if (el.muted) { el.muted = false; setMuted(false); } };
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pointerdown", grant, { once: true });
    window.addEventListener("keydown", grant, { once: true });
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pointerdown", grant);
      window.removeEventListener("keydown", grant);
      el.pause();
    };
  }, [hasFilm, src]);

  const unmute = () => {
    const el = video.current;
    if (!el) return;
    el.muted = false;
    setMuted(false);
    void el.play().catch(() => undefined);
  };

  return (
    <section className="lp-section lp-film" id="film" aria-labelledby="lp-film-title">
      <div className="lp-film-side">
        <h2 id="lp-film-title" data-reveal>What is <span>RiceGuardAI?</span></h2>
        <p data-reveal>Mula sa isang drone photo hanggang sa text sa magsasaka, sa loob ng ilang minuto.</p>
        <img className="lp-film-mascot" src="/images/mascot/presenter-pointer.webp" alt="" width={640} height={621} loading="lazy" decoding="async" />
      </div>
      <div className="lp-film-frame" data-reveal ref={frame}>
        {hasFilm === null ? null : (
          <video ref={video} key={src} playsInline preload="metadata" poster={poster} disablePictureInPicture
            controlsList="nodownload nofullscreen noplaybackrate noremoteplayback" onContextMenu={(event) => event.preventDefault()}
            aria-label="RiceGuardAI explainer film">
            <source src={src} type="video/mp4" />
            Your browser cannot play this video.
          </video>
        )}
        {muted ? (
          <button type="button" className="lp-film-sound" onClick={unmute} aria-label="Turn on sound">
            <Volume2 size={18} /> Tap for sound
          </button>
        ) : null}
      </div>
    </section>
  );
}

const PROVINCES = [
  { name: "Batanes", lat: 20.45, lng: 121.97 },
  { name: "Cagayan", lat: 17.61, lng: 121.73 },
  { name: "Isabela", lat: 17.15, lng: 121.89 },
  { name: "Nueva Vizcaya", lat: 16.48, lng: 121.15 },
  { name: "Quirino", lat: 16.49, lng: 121.54 },
] as const;

function formatDay(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
}

function AdvisoriesSection({ items, loading, error }: { items: Bulletin[]; loading: boolean; error: string }) {
  return (
    <section className="lp-section lp-latest" aria-labelledby="lp-latest-title">
      <div className="lp-section-head is-row" data-reveal>
        <div>
          <h2 id="lp-latest-title">Latest field advisories</h2>
          <p>Automatic findings with what to do next. A ? means a specialist has not checked it yet.</p>
        </div>
        <Link className="lp-button lp-button-dark" to="/bulletin">Open the bulletin <ArrowRight size={17} /></Link>
      </div>
      <div className="lp-advisories" data-reveal>
        {loading ? (
          [0, 1, 2].map((index) => <div key={index} className="lp-advisory is-loading" />)
        ) : items.length ? (
          items.slice(0, 3).map((item) => {
            const image = item.media?.find((entry) => entry.type === "image")?.url || item.image;
            return (
              <Link key={item.id} to={`/advisories/${item.slug}`} className="lp-advisory">
                <div className="lp-advisory-media">{image ? <img src={image} alt="" loading="lazy" decoding="async" /> : null}<span className="lp-pill">{reviewedDiseaseLabel(item) === "BLB" ? "Bacterial Leaf Blight" : reviewedDiseaseLabel(item)}</span></div>
                <div className="lp-advisory-body">
                  <span className="lp-advisory-meta"><time dateTime={item.published_at}>{formatDay(item.published_at || item.date)}</time><VerificationBadge status={item.verification_status} size="sm" /></span>
                  <strong>{item.title}</strong>
                  <small><MapPin size={13} /> {item.location}</small>
                </div>
              </Link>
            );
          })
        ) : (
          <div className="lp-advisory-empty">
            <img src="/images/mascot/bulletin-reader-v2.png" alt="" width="160" height="160" loading="lazy" />
            <div>
              <strong>{error ? "Field updates are out of reach right now." : "No published advisories yet."}</strong>
              <p>{error ? "Please check back in a little while." : "Only analysed surveys appear here. An empty bulletin does not mean a field is disease-free."}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function MapSection({ items }: { items: Bulletin[] }) {
  const [shell, near] = useNearViewport<HTMLDivElement>();
  return (
    <section className="lp-section lp-map" aria-labelledby="lp-map-title">
      <div className="lp-map-card" data-reveal>
        <div className="lp-map-copy">
          <h2 id="lp-map-title">Where the updates come from</h2>
          <p>Browse updates across the five provinces of Region II. Each marker is a surveyed field; farmers' names and numbers stay private.</p>
          <ul className="lp-map-provinces">{PROVINCES.map((item) => <li key={item.name}>{item.name}</li>)}</ul>
          <Link className="lp-button" to="/map">Explore the map <ArrowUpRight size={17} /></Link>
        </div>
        <div className="lp-map-shell" ref={shell} data-ui data-lenis-prevent-wheel>
          {near ? <FieldMap publicView points={items.filter((item) => item.lat != null && item.lng != null).map(bulletinMapPoint)} /> : <div className="lp-map-placeholder" />}
        </div>
      </div>
    </section>
  );
}

function CloseSection({ smsPath, smsLabel }: { smsPath: string; smsLabel: string }) {
  return (
    <section className="lp-close" aria-labelledby="lp-close-title" data-live>
      <div className="lp-close-glow" aria-hidden="true" />
      <div className="lp-close-inner" data-reveal>
        <h2 id="lp-close-title"><span>Know before</span> <span>it spreads.</span></h2>
        <p>Register your farm and mobile number. We text you when a disease is found in fields near yours.</p>
        <div className="lp-close-actions">
          <Link className="lp-button lp-button-lg" to={smsPath}>{smsLabel} <MessageSquareText size={18} /></Link>
          <Link className="lp-ghost" to="/bulletin">Read the bulletin <ArrowRight size={16} /></Link>
        </div>
      </div>
      <div className="lp-close-art" data-parallax="0.12"><img className="lp-close-mascot" src="/images/mascot/mascot-wave.webp" alt="" width="420" height="397" loading="lazy" decoding="async" /></div>
    </section>
  );
}

function LandingFooter({ smsPath, registered }: { smsPath: string; registered: boolean }) {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-cols">
        <div className="lp-footer-brand"><Wordmark light /><p>Drone imagery, two disease models and specialist checks, for rice farmers in Region II.</p></div>
        <div><strong>Public information</strong><Link to="/bulletin">Field advisories</Link><Link to="/map">Monitoring map</Link><Link to={smsPath}>{registered ? "SMS preferences" : "SMS registration"}</Link></div>
        <div><strong>Account</strong><Link to="/preferences">Alert preferences</Link><Link to="/login">Authorized staff login</Link></div>
        <div><strong>Coverage</strong><span>Batanes, Cagayan, Isabela, Nueva Vizcaya and Quirino</span></div>
      </div>
      <svg className="lp-footer-word" viewBox="0 0 1000 150" role="img" aria-label="RiceGuardAI">
        <text x="0" y="122" textLength="1000" lengthAdjust="spacingAndGlyphs">RiceGuard<tspan>AI</tspan></text>
      </svg>
      <small>© {new Date().getFullYear()} RiceGuardAI · Decision support only. Field verification by your agriculturist remains required.</small>
    </footer>
  );
}

export function HomePage() {
  const page = useRef<HTMLDivElement>(null);
  const registered = useSmsRegistrationStatus();
  const smsPath = registered ? "/preferences" : "/register";
  const smsLabel = registered ? "SMS preferences" : "Get SMS alerts";
  const { items, loading, error } = usePublicPosts({ limit: 4 });
  useSmoothScroll();
  useViewportClasses(page);
  useParallax(page);
  return (
    <div className="lp" ref={page}>
      <a className="rg-skip" href="#main">Skip to content</a>
      <LandingHeader smsPath={smsPath} smsLabel={smsLabel} />
      <main id="main">
        <Hero latest={items[0]} smsPath={smsPath} smsLabel={smsLabel} />
        <Ticker />
        <ProblemSection />
        <SeeSection />
        <HowSection />
        <FilmSection />
        <AdvisoriesSection items={items} loading={loading} error={error} />
        <MapSection items={items} />
        <CloseSection smsPath={smsPath} smsLabel={smsLabel} />
      </main>
      <LandingFooter smsPath={smsPath} registered={registered} />
      <AssistantWidget />
    </div>
  );
}
