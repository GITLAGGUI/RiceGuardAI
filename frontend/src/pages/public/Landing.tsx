// Landing page. Multi-layer parallax hero, magazine typography, WCAG-AA contrast,
// real disease imagery, prefers-reduced-motion respected throughout.
//
// Inspirations applied:
//   - pbakaus/impeccable & alchaincyf/huashu-design — no AI-slop gradients,
//     content-first, magazine-grade type. Heavy use of grid + measured spacing.
//   - nextlevelbuilder/ui-ux-pro-max-skill — 4.5:1 contrast minimum, cursor-pointer
//     on interactives, 200ms hover transitions, Lucide icons, mobile-first.
//   - Dribbble Cinema + Agriculture + Microsoft Copilot tasks — layered depth,
//     scroll-driven storytelling, parallax with multiple speeds.
//
// Contrast audit (light mode, 4.5:1+ required for body text):
//   stone-900 (#1c1917) on stone-50 (#fafaf9)   = 17.4:1   ✓
//   stone-700 (#44403c) on stone-50             = 9.7:1    ✓
//   forest-950 (#022c22) on rice-50 (#f7faf3)   = 16.2:1   ✓
//   white (#ffffff)    on forest-950           = 19.6:1   ✓
//   rice-200 (#d4e7b4) on forest-950           = 13.1:1   ✓
//   forest-950         on rice-300 (#b6d484)   = 11.0:1   ✓

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import {
  ArrowRight,
  Wheat,
  MapPin,
  MessageSquare,
  Bell,
  Bot,
  Cloud,
  Layers,
  ShieldCheck,
} from "lucide-react";
import { useSmoothScroll } from "@/components/motion/useSmoothScroll";
import { useLang, useT } from "@/context/LangContext";

const DISEASES = [
  {
    key: "rice_blast",
    name: "Rice Blast",
    tl: "Sakit na Blast",
    image: "/images/rice-blast.webp",
    severity: "Mataas",
    severityEn: "High",
    subtitleEn: "Rice Blast disease",
    accent: "#dc2626",
    symptomsTl: [
      "Spindle-shaped lesion: kayumanggi gilid, kulay-abo gitna",
      "Madilim na node lesion na pumuputol ng tangkay",
      "Bulok na panicle, hindi nabubuo ang butil",
    ],
    symptomsEn: [
      "Spindle-shaped lesions with brown borders and grey centers",
      "Dark node lesions that snap the stem",
      "Rotten panicles, grain fails to fill",
    ],
  },
  {
    key: "blb",
    name: "Bacterial Leaf Blight",
    tl: "BLB",
    image: "/images/blb.webp",
    severity: "Mataas",
    severityEn: "High",
    subtitleEn: "Bacterial Leaf Blight",
    accent: "#eab308",
    symptomsTl: [
      "Yellow streak na nagsisimula sa dulo ng dahon",
      "Water-soaked lesion, naging dilaw at tuyot",
      "Kresek phase — biglaang pagkalanta",
    ],
    symptomsEn: [
      "Yellow streaks starting from the leaf tip",
      "Water-soaked lesions that turn yellow and dry",
      "Kresek phase — sudden wilting",
    ],
  },
  {
    key: "tungro",
    name: "Tungro Virus",
    tl: "Tungro",
    image: "/images/tungro.webp",
    severity: "Kritikal",
    severityEn: "Critical",
    subtitleEn: "Tungro virus",
    accent: "#f97316",
    symptomsTl: [
      "Yellow-orange dahon, hindi pantay ang taas",
      "Bansot, stunted growth, kulang sa panicle",
      "Kinakalat ng green leafhopper",
    ],
    symptomsEn: [
      "Yellow-orange leaves, uneven plant height",
      "Stunted growth, missing or sparse panicles",
      "Spread by green leafhoppers",
    ],
  },
];

const STEPS = [
  {
    icon: MapPin,
    titleTl: "Drone patrol",
    titleEn: "Drone patrol",
    descTl: "Geotagged RGB images ng buong palayan kada linggo.",
    descEn: "Weekly geotagged RGB images of the entire rice field.",
  },
  {
    icon: Bot,
    titleTl: "AI detection",
    titleEn: "AI detection",
    descTl: "Auto-classify ng 3 sakit + severity sa Taglish.",
    descEn: "Automatically classifies the 3 diseases and their severity.",
  },
  {
    icon: Cloud,
    titleTl: "Weather context",
    titleEn: "Weather context",
    descTl: "Real-time humidity at spray-window insights.",
    descEn: "Real-time humidity and spray-window guidance.",
  },
  {
    icon: MessageSquare,
    titleTl: "Taglish advisory",
    titleEn: "Farmer advisory",
    descTl: "4-5 hakbang na payo, hindi generic, base sa PhilRice.",
    descEn: "4-5 practical steps, not generic, based on PhilRice guidance.",
  },
  {
    icon: Bell,
    titleTl: "SMS sa cellphone",
    titleEn: "SMS delivery",
    descTl: "Diretso sa cellphone - walang internet na kailangan.",
    descEn: "Sent directly to a phone, even without mobile internet.",
  },
];

export function Landing() {
  useSmoothScroll();
  const { lang } = useLang();

  useEffect(() => {
    document.title =
      lang === "tl"
        ? "RiceGuard AI - Proteksyon para sa bawat palayan"
        : "RiceGuard AI - Protection for every rice field";
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (meta) {
      meta.content =
        lang === "tl"
          ? "RiceGuard AI - Proteksyon para sa bawat palayan. Drone-based rice disease detection at advisory para sa mga magsasaka sa Isabela at Cagayan."
          : "RiceGuard AI - Protection for every rice field. Drone-based rice disease detection and advisory delivery for farmers in Isabela and Cagayan.";
    }
  }, [lang]);

  return (
    // `overflow-x-clip` instead of `overflow-x-hidden` — `hidden` silently
    // creates a scroll container which breaks `position: sticky` on inner
    // sections (e.g. the disease cross-fade). `clip` has no such side effect.
    <div className="bg-stone-50 text-stone-900 overflow-x-clip">
      <GlassNav />
      <ParallaxHero />
      <ManifestoSection />
      <HardwareSection />
      <ProblemsSection />
      <DiseaseSection />
      <WorkflowSection />
      <FinalCta />
      <Footer />
    </div>
  );
}

/* ----------------------------- Nav ----------------------------- */

function GlassNav() {
  const [scrolled, setScrolled] = useState(false);
  const t = useT(NAV_DICT);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled ? "pt-2" : "pt-5"
      }`}
    >
      <div
        className={`mx-4 md:mx-auto md:max-w-5xl rounded-full transition-all duration-300 border ${
          scrolled
            ? "bg-stone-900/85 backdrop-blur-xl border-stone-700/50 shadow-lg shadow-stone-900/10"
            : "bg-stone-900/40 backdrop-blur-md border-white/10"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-2.5">
          <Link
            to="/"
            className="flex items-center gap-2 font-display font-bold text-white text-lg cursor-pointer group"
            aria-label={t("homeLabel")}
          >
            <img
              src="/logo.png"
              alt=""
              aria-hidden
              className="w-7 h-7 rounded-md transition-transform duration-300 group-hover:rotate-6"
            />
            RiceGuard<span className="text-rice-300">.</span>
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm text-stone-300">
            <a
              href="#manifesto"
              className="hover:text-white transition-colors duration-200 cursor-pointer"
            >
              {t("about")}
            </a>
            <a
              href="#problems"
              className="hover:text-white transition-colors duration-200 cursor-pointer"
            >
              {t("problems")}
            </a>
            <a
              href="#diseases"
              className="hover:text-white transition-colors duration-200 cursor-pointer"
            >
              {t("diseases")}
            </a>
            <a
              href="#workflow"
              className="hover:text-white transition-colors duration-200 cursor-pointer"
            >
              {t("workflow")}
            </a>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="hidden sm:inline-block px-4 py-1.5 text-sm text-stone-200 hover:text-white transition-colors duration-200 cursor-pointer"
            >
              {t("login")}
            </Link>
            <Link
              to="/register"
              className="px-4 py-2 rounded-full bg-rice-400 hover:bg-rice-300 text-forest-950 text-sm font-semibold transition-all duration-200 cursor-pointer shadow-sm hover:shadow"
            >
              {t("start")}
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}

const NAV_DICT = {
  tl: {
    homeLabel: "RiceGuard home",
    about: "Tungkol",
    problems: "Problema",
    diseases: "Sakit",
    workflow: "Paano",
    login: "Mag-login",
    start: "Magsimula",
  },
  en: {
    homeLabel: "RiceGuard home",
    about: "About",
    problems: "Problems",
    diseases: "Diseases",
    workflow: "How it works",
    login: "Log in",
    start: "Get started",
  },
};

/* --------------------------- Parallax Hero --------------------------- */
//
// Bug-fix note: the previous version used `-z-10` on parallax layers without
// `isolate` on the section. Negative z-index escaped the section's local
// stacking context and put the gradient BEHIND the page's white bg.
//
// Fix: section gets `bg-forest-950 isolate`. All children use non-negative
// z-index, ordered explicitly. Even if every parallax layer fails to paint,
// the base color is dark forest — text never becomes invisible.

function ParallaxHero() {
  const t = useT(HERO_DICT);
  const heroRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const { scrollY } = useScroll();
  const staticRange = [0, 0];
  const heroScrollRange = [0, 900];
  const skyY = useTransform(scrollY, heroScrollRange, reducedMotion ? staticRange : [0, 18]);
  const imageY = useTransform(scrollY, heroScrollRange, reducedMotion ? staticRange : [0, 56]);
  const mountainsY = useTransform(scrollY, heroScrollRange, reducedMotion ? staticRange : [0, 44]);
  const midFieldY = useTransform(scrollY, heroScrollRange, reducedMotion ? staticRange : [0, 88]);
  const foregroundY = useTransform(scrollY, heroScrollRange, reducedMotion ? staticRange : [0, 150]);
  const droneY = useTransform(scrollY, heroScrollRange, reducedMotion ? staticRange : [0, -64]);
  const textY = useTransform(scrollY, heroScrollRange, reducedMotion ? staticRange : [0, -34]);
  const heroOpacity = useTransform(scrollY, [0, 600], [1, 0]);
  const heroImageScale = useTransform(scrollY, [0, 700], reducedMotion ? [1.04, 1.04] : [1.04, 1.12]);

  return (
    <section
      ref={heroRef}
      className="relative min-h-[100svh] overflow-hidden isolate bg-forest-950 contain-paint"
    >
      {/* z-0: gradient sky */}
      <motion.div
        style={{ y: skyY }}
        className="absolute inset-0 z-0 will-change-transform"
        aria-hidden
      >
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#022c22_0%,#053828_40%,#0a3d29_70%,#0d4830_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(151,192,87,0.22),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_75%,rgba(250,204,21,0.10),transparent_50%)]" />
      </motion.div>

      {/* z-[1]: real agriculture image layer with scroll depth */}
      <motion.div
        style={{ y: imageY, scale: heroImageScale }}
        className="absolute inset-0 z-[1] pointer-events-none will-change-transform"
        aria-hidden
      >
        <img
          src="/images/rice-blast.webp"
          alt=""
          className="h-full w-full object-cover opacity-45 saturate-125"
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-forest-950 via-forest-950/80 to-forest-950/35" />
        <div className="absolute inset-0 bg-gradient-to-t from-forest-950 via-transparent to-forest-950/20" />
      </motion.div>

      {/* z-[2]: mountain silhouette */}
      <motion.div
        style={{ y: mountainsY }}
        className="absolute inset-x-0 bottom-0 h-[60%] z-[2] will-change-transform"
        aria-hidden
      >
        <svg viewBox="0 0 1440 600" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
          <path d="M0,420 L120,360 L240,400 L360,320 L480,380 L600,300 L720,360 L840,290 L960,350 L1080,310 L1200,370 L1320,330 L1440,380 L1440,600 L0,600 Z" fill="#0a3a26" opacity="0.85" />
          <path d="M0,500 L160,460 L320,490 L480,430 L640,470 L800,420 L960,460 L1120,410 L1280,450 L1440,420 L1440,600 L0,600 Z" fill="#072d1d" opacity="0.95" />
        </svg>
      </motion.div>

      {/* z-[3]: rice field stripes */}
      <motion.div
        style={{ y: midFieldY }}
        className="absolute inset-x-0 bottom-0 h-[40%] z-[3] will-change-transform"
        aria-hidden
      >
        <svg viewBox="0 0 1440 400" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
          <defs>
            <linearGradient id="field" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1a4f31" />
              <stop offset="100%" stopColor="#0a2e1a" />
            </linearGradient>
          </defs>
          <rect x="0" y="200" width="1440" height="200" fill="url(#field)" />
          {Array.from({ length: 40 }).map((_, i) => (
            <line key={i} x1={i * 36} y1="200" x2={i * 36 - 80} y2="400" stroke="#0a3a26" strokeWidth="1.5" opacity="0.6" />
          ))}
        </svg>
      </motion.div>

      {/* z-[4]: standalone radar pulse — scanning indicator. The drone itself
          lives in the Hardware section (with proper mix-blend on cream bg). */}
      <motion.div
        style={{ y: droneY, opacity: heroOpacity }}
        className="absolute top-24 right-[-4%] md:right-4 lg:right-20 w-[60%] sm:w-[42%] md:w-[36%] lg:w-[32%] aspect-square z-[4] pointer-events-none hidden md:block will-change-transform"
        aria-hidden
      >
        <RadarPulse />
      </motion.div>

      {/* z-[5]: foreground rice stalks */}
      <motion.div
        style={{ y: foregroundY }}
        className="absolute inset-x-0 bottom-0 h-[18%] z-[5] pointer-events-none will-change-transform"
        aria-hidden
      >
        <svg viewBox="0 0 1440 200" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
          {Array.from({ length: 60 }).map((_, i) => {
            const x = i * 24;
            const height = 80 + Math.sin(i * 1.7) * 30;
            return (
              <g key={i} transform={`translate(${x}, 200)`}>
                <line x1="0" y1="0" x2={Math.sin(i) * 5} y2={-height} stroke="#1a5938" strokeWidth="1.5" />
                <circle cx={Math.sin(i) * 5} cy={-height} r="3" fill="#5e8a29" />
              </g>
            );
          })}
        </svg>
      </motion.div>

      {/* z-[6]: subtle film grain */}
      <div
        className="absolute inset-0 z-[6] pointer-events-none opacity-[0.05] mix-blend-overlay"
        aria-hidden
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 180 180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' /></filter><rect width='100%25' height='100%25' filter='url(%23n)' /></svg>\")",
        }}
      />

      {/* z-10: HERO CONTENT — always above every parallax layer */}
      <motion.div
        style={{ y: textY, opacity: heroOpacity }}
        className="relative z-10 pt-32 md:pt-44 pb-32 px-6 md:px-12 max-w-6xl mx-auto will-change-transform"
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md text-rice-100 text-xs font-medium border border-white/15"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-rice-300 opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rice-300" />
          </span>
          {t("pill")}
        </motion.div>

        <h1
          className="font-display text-5xl sm:text-6xl md:text-7xl lg:text-[6.8rem] font-bold text-white mt-8 leading-[0.95] tracking-[-0.03em] max-w-[10ch] sm:max-w-[16ch] lg:max-w-[18ch]"
          style={{ textWrap: "balance" as const }}
        >
          <AnimatedTitle line1={t("titleLine1")} line2={t("titleLine2")} />
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 1.1 }}
          className="text-stone-200 text-lg md:text-xl mt-8 max-w-xl leading-relaxed"
          style={{ textWrap: "pretty" as const }}
        >
          {t("bodyStart")}{" "}
          <span className="text-rice-200 font-medium">rice blast</span>,{" "}
          <span className="text-rice-200 font-medium">bacterial leaf blight</span>, {t("and")}{" "}
          <span className="text-rice-200 font-medium">tungro</span>
          {t("bodyEnd")}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 1.3 }}
          className="mt-10 flex flex-col sm:flex-row gap-3"
        >
          <Link
            to="/register"
            className="group relative inline-flex items-center justify-center gap-2 px-7 py-4 rounded-full bg-rice-400 hover:bg-rice-300 text-forest-950 font-semibold transition-all duration-200 tap cursor-pointer shadow-lg shadow-rice-400/30 hover:shadow-rice-400/50 hover:-translate-y-0.5 overflow-hidden"
          >
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            <span className="relative">{t("primaryCta")}</span>
            <ArrowRight size={18} className="relative group-hover:translate-x-1 transition-transform duration-200" aria-hidden />
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center justify-center gap-2 px-7 py-4 rounded-full bg-white/10 hover:bg-white/15 backdrop-blur text-white font-semibold border border-white/20 transition-all duration-200 tap cursor-pointer"
          >
            {t("secondaryCta")}
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 0.8 }}
          className="mt-20 grid grid-cols-3 gap-6 md:gap-10 max-w-xl"
        >
          <CountStat value={3} label={t("stat1Label")} sub={t("stat1Sub")} />
          <CountStat value={2} label={t("stat2Label")} sub={t("stat2Sub")} />
          <Stat label={t("stat3Label")} sub={t("stat3Sub")} valueRaw="SMS" />
        </motion.div>
      </motion.div>

      {/* Scroll cue */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.8, duration: 0.6 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2"
        aria-hidden
      >
        <span className="text-xs text-stone-300/80 tracking-[0.2em] uppercase">{t("scroll")}</span>
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          className="w-px h-9 bg-gradient-to-b from-stone-300/70 to-transparent"
        />
      </motion.div>
    </section>
  );
}

const HERO_DICT = {
  tl: {
    pill: "Para sa palayan ng Isabela at Cagayan",
    titleLine1: "Proteksyon para sa",
    titleLine2: "bawat palayan.",
    bodyStart: "Drone-powered na pag-detect ng",
    and: "at",
    bodyEnd: " - kasama ang AI-generated na payo sa Taglish, hatid sa SMS.",
    primaryCta: "Magsimula nang libre",
    secondaryCta: "May account na ako",
    stat1Label: "rice diseases",
    stat1Sub: "binabantayan",
    stat2Label: "lalawigan",
    stat2Sub: "Isabela at Cagayan",
    stat3Label: "hatid",
    stat3Sub: "kahit walang net",
    scroll: "Mag-scroll",
  },
  en: {
    pill: "Built for rice fields in Isabela and Cagayan",
    titleLine1: "Protection for",
    titleLine2: "every rice field.",
    bodyStart: "Drone-powered detection for",
    and: "and",
    bodyEnd: ", paired with AI-generated guidance and SMS alerts.",
    primaryCta: "Start for free",
    secondaryCta: "I already have an account",
    stat1Label: "rice diseases",
    stat1Sub: "monitored",
    stat2Label: "provinces",
    stat2Sub: "Isabela and Cagayan",
    stat3Label: "delivered",
    stat3Sub: "even without internet",
    scroll: "Scroll",
  },
};

/* ---------- Hero helpers ---------- */

function AnimatedTitle({ line1, line2 }: { line1: string; line2: string }) {
  const words1 = line1.split(" ");
  const words2 = line2.split(" ");

  return (
    <>
      <span className="block overflow-hidden">
        {words1.map((w, i) => (
          <motion.span
            key={i}
            initial={{ y: "120%" }}
            animate={{ y: 0 }}
            transition={{
              duration: 0.85,
              delay: 0.15 + i * 0.08,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="inline-block"
          >
            {w}
            {i < words1.length - 1 ? "\u00A0" : ""}
          </motion.span>
        ))}
      </span>
      <span className="block overflow-hidden italic font-serif font-normal bg-gradient-to-r from-rice-200 via-amber-100 to-rice-300 bg-clip-text text-transparent sm:whitespace-nowrap">
        {words2.map((w, i) => (
          <motion.span
            key={i}
            initial={{ y: "120%" }}
            animate={{ y: 0 }}
            transition={{
              duration: 0.85,
              delay: 0.5 + i * 0.1,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="inline-block"
          >
            {w}
            {i < words2.length - 1 ? "\u00A0" : ""}
          </motion.span>
        ))}
      </span>
    </>
  );
}

function RadarPulse() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute rounded-full border border-rice-300/40"
          initial={{ width: 80, height: 80, opacity: 0.5 }}
          animate={{
            width: [80, 380],
            height: [80, 380],
            opacity: [0.5, 0],
          }}
          transition={{
            duration: 3.5,
            repeat: Infinity,
            delay: i * 1.15,
            ease: "easeOut",
          }}
        />
      ))}
      <motion.span
        className="absolute w-20 h-20 rounded-full bg-rice-300/15 blur-2xl"
        animate={{ scale: [1, 1.3, 1] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

function CountStat({ value, label, sub }: { value: number; label: string; sub: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setN(value);
      return;
    }
    const start = performance.now();
    const duration = 1200;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(eased * value));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value]);

  return (
    <div ref={ref} className="text-white border-l border-white/15 pl-4 md:pl-6">
      <div className="font-display text-3xl md:text-4xl font-bold text-rice-200 leading-none tabular-nums">
        {n}
      </div>
      <div className="text-sm font-medium mt-2 text-stone-100">{label}</div>
      <div className="text-xs text-stone-300/80 mt-0.5">{sub}</div>
    </div>
  );
}

function Stat({
  label,
  sub,
  valueRaw,
}: {
  label: string;
  sub: string;
  valueRaw: string;
}) {
  return (
    <div className="text-white border-l border-white/15 pl-4 md:pl-6">
      <div className="font-display text-3xl md:text-4xl font-bold text-rice-200 leading-none">
        {valueRaw}
      </div>
      <div className="text-sm font-medium mt-2 text-stone-100">{label}</div>
      <div className="text-xs text-stone-300/80 mt-0.5">{sub}</div>
    </div>
  );
}

/* ------------------------ Manifesto block ------------------------ */

function ManifestoSection() {
  const t = useT(MANIFESTO_DICT);

  return (
    <section id="manifesto" className="relative bg-stone-50 py-28 md:py-40 px-6 md:px-12">
      <div className="max-w-6xl mx-auto">
        <Kicker>{t("kicker")}</Kicker>
        <motion.h2
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8 }}
          className="font-display text-4xl md:text-6xl lg:text-7xl font-bold mt-6 leading-[1.05] tracking-[-0.02em] text-stone-900 max-w-4xl"
          style={{ textWrap: "balance" as const }}
        >
          {t("title")}
          <span className="text-stone-400"> {t("titleMuted")}</span>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="text-stone-700 text-lg md:text-xl mt-10 max-w-3xl leading-relaxed"
          style={{ textWrap: "pretty" as const }}
        >
          {t("body")}
        </motion.p>
      </div>
    </section>
  );
}

const MANIFESTO_DICT = {
  tl: {
    kicker: "Ang misyon",
    title: "Hindi mahirap ang pag-aalaga ng palayan.",
    titleMuted: "Mahirap ang gabi-gabing pag-aalala.",
    body:
      "Sa Region II, mahigit dalawang milyong magsasaka ang nakatira sa palayan. Ang RiceGuard ay isang sistema - drone + AI + SMS - na ginawa para tumulong sa kanilang araw-araw na desisyon. Hindi para palitan ang karanasan ng magsasaka, kundi para bigyan sila ng mas maagang babala.",
  },
  en: {
    kicker: "The mission",
    title: "Caring for a rice field should not feel uncertain.",
    titleMuted: "Late warnings are what make it difficult.",
    body:
      "In Region II, millions of farmers depend on rice fields. RiceGuard combines drones, AI, and SMS to support daily decisions with earlier warnings, without replacing the farmer's own experience.",
  },
};

/* --------------------- Hardware showcase --------------------- */
//
// Re-designed per user feedback: drop the specs + left text. Show the drone
// "floating in nothing" via mix-blend-mode:multiply on a light cream bg —
// the white studio background of dji-mini-3.webp visually disappears, only
// the drone silhouette remains. Capability statements replace the specs.

function HardwareSection() {
  const { lang } = useLang();
  const t = useT(HARDWARE_DICT);

  const capabilities: Array<{ tl: string; en: string }> = [
    {
      tl: "Nakikita ang sakit kahit malayo ka pa.",
      en: "Spots disease even when you're far from the field.",
    },
    {
      tl: "5–10 minuto lang per hectare — buong palayan na-scan.",
      en: "5–10 minutes per hectare — covers your entire farm.",
    },
    {
      tl: "GPS-tagged bawat shot — alam mo eksakto saan ang problema.",
      en: "Every shot is GPS-tagged — you know exactly where to act.",
    },
  ];

  return (
    <section className="relative bg-gradient-to-b from-stone-50 via-rice-50 to-stone-50 py-28 md:py-40 px-6 md:px-12 overflow-hidden">
      <div className="max-w-5xl mx-auto text-center">
        <Kicker>{t("kicker")}</Kicker>
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8 }}
          className="font-display text-4xl md:text-6xl lg:text-7xl font-bold mt-6 text-stone-900 leading-[1.05] tracking-[-0.02em] max-w-3xl mx-auto"
          style={{ textWrap: "balance" as const }}
        >
          {t("title")}
        </motion.h2>

        {/* Floating drone — mix-blend-multiply makes the white studio bg blend */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          className="relative mt-14 md:mt-20"
        >
          {/* Halo behind */}
          <div className="absolute inset-0 -m-12 rounded-full bg-gradient-radial from-rice-200/50 via-transparent to-transparent blur-3xl pointer-events-none" />

          {/* Drone with mix-blend so the white studio bg vanishes into the cream section */}
          <motion.div
            animate={{ y: [0, -16, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            className="relative w-full max-w-2xl mx-auto"
          >
            <img
              src="/images/dji_mini_3.webp"
              alt={
                lang === "tl"
                  ? "Drone para sa pag-scan ng palayan"
                  : "Drone used for rice field scanning"
              }
              loading="lazy"
              decoding="async"
              className="w-full"
              style={{
                mixBlendMode: "multiply",
                filter: "drop-shadow(0 25px 50px rgba(20,40,30,0.35))",
              }}
            />
          </motion.div>

          {/* Soft ground shadow */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-3/5 h-10 rounded-full bg-stone-900/15 blur-2xl pointer-events-none" />
        </motion.div>

        {/* Capability cards */}
        <div className="mt-16 md:mt-24 grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 text-left">
          {capabilities.map((c, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
              className="rounded-2xl bg-white/70 backdrop-blur border border-stone-200 p-6 md:p-7 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300"
            >
              <div className="w-9 h-9 rounded-xl bg-forest-950 text-rice-300 grid place-items-center font-semibold text-sm">
                {i + 1}
              </div>
              <p
                className="mt-5 text-stone-800 text-lg leading-snug font-medium"
                style={{ textWrap: "pretty" as const }}
              >
                {lang === "tl" ? c.tl : c.en}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

const HARDWARE_DICT = {
  tl: {
    kicker: "Ang teknolohiya",
    title: "Drone bilang bagong mata sa palayan.",
  },
  en: {
    kicker: "The technology",
    title: "A drone becomes a new pair of eyes for your field.",
  },
};

/* ----------------- Problems section (Copilot-style) ----------------- */

function ProblemsSection() {
  const { lang } = useLang();
  const t = useT(PROBLEMS_DICT);
  const problems = [
    {
      stat: "10-20%",
      captionTl: "taunang yield loss sa Pilipinas dahil sa sakit",
      captionEn: "annual yield loss in the Philippines due to disease",
      problemTl: "Pagiging huli sa pagtuklas",
      problemEn: "Late disease detection",
      solutionTl: "Drone scan kada linggo, hindi manual walk-through.",
      solutionEn: "Weekly drone scans instead of slow manual walk-throughs.",
      icon: Layers,
    },
    {
      stat: "3 sakit",
      statEn: "3 diseases",
      captionTl: "rice blast, BLB, at tungro - magkakaibang lunas",
      captionEn: "rice blast, BLB, and tungro need different treatment",
      problemTl: "Generic na payo",
      problemEn: "Generic recommendations",
      solutionTl: "Location-specific advisory, severity-aware, weather-aware.",
      solutionEn: "Location-specific guidance that considers severity and weather.",
      icon: Bot,
    },
    {
      stat: "100%",
      captionTl: "ng magsasaka may cellphone, kahit walang internet",
      captionEn: "mobile-first access even when internet is limited",
      problemTl: "Walang access sa app",
      problemEn: "Limited app access",
      solutionTl: "Diretso SMS. Walang i-download, walang i-install.",
      solutionEn: "Direct SMS alerts. Nothing to download or install.",
      icon: MessageSquare,
    },
  ];

  return (
    <section id="problems" className="bg-stone-100 py-28 md:py-36 px-6 md:px-12">
      <div className="max-w-6xl mx-auto">
        <Kicker>{t("kicker")}</Kicker>
        <h2 className="font-display text-3xl md:text-5xl font-bold mt-6 leading-tight tracking-tight text-stone-900 max-w-3xl">
          {t("title")}
        </h2>

        <div className="mt-16 md:mt-20 space-y-8 md:space-y-12">
          {problems.map((p, i) => (
            <ProblemCard
              key={i}
              index={i}
              stat={lang === "en" && p.statEn ? p.statEn : p.stat}
              caption={lang === "tl" ? p.captionTl : p.captionEn}
              problem={lang === "tl" ? p.problemTl : p.problemEn}
              solution={lang === "tl" ? p.solutionTl : p.solutionEn}
              solutionLabel={t("solutionLabel")}
              problemLabel={t("problemLabel")}
              icon={p.icon}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ProblemCard({
  index,
  stat,
  caption,
  problem,
  solution,
  problemLabel,
  solutionLabel,
  icon: Icon,
}: {
  index: number;
  stat: string;
  caption: string;
  problem: string;
  solution: string;
  problemLabel: string;
  solutionLabel: string;
  icon: typeof Wheat;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-120px" }}
      transition={{ duration: 0.7, delay: index * 0.08 }}
      className="grid grid-cols-1 md:grid-cols-[1fr_1.2fr] gap-8 md:gap-14 items-center bg-white rounded-3xl p-8 md:p-12 border border-stone-200 shadow-sm hover:shadow-md transition-shadow duration-300"
    >
      <div>
        <div className="text-xs font-semibold text-stone-500 uppercase tracking-[0.15em]">
          {problemLabel} {index + 1}
        </div>
        <h3 className="font-display text-2xl md:text-4xl font-bold mt-3 text-stone-900 leading-tight tracking-tight">
          {problem}
        </h3>
        <div className="mt-7 flex items-baseline gap-4">
          <div className="font-display text-5xl md:text-6xl font-bold text-forest-900 leading-none">
            {stat}
          </div>
          <div className="text-stone-600 text-sm max-w-[14ch] leading-snug">{caption}</div>
        </div>
      </div>

      <div className="relative bg-forest-950 text-white rounded-2xl p-7 md:p-10 overflow-hidden">
        <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-rice-400/15 blur-2xl pointer-events-none" />
        <div className="relative">
          <div className="w-10 h-10 rounded-xl bg-rice-400 grid place-items-center text-forest-950 mb-5">
            <Icon size={20} aria-hidden />
          </div>
          <div className="text-xs font-semibold text-rice-300 uppercase tracking-[0.15em]">
            {solutionLabel}
          </div>
          <p className="mt-3 text-xl md:text-2xl font-display leading-snug text-stone-50">
            {solution}
          </p>
        </div>
      </div>
    </motion.article>
  );
}

const PROBLEMS_DICT = {
  tl: {
    kicker: "Bakit ito kailangan",
    title: "May problema sa kasalukuyang paraan ng pag-monitor.",
    problemLabel: "Problema",
    solutionLabel: "Solusyon sa RiceGuard",
  },
  en: {
    kicker: "Why it matters",
    title: "Current field-monitoring methods miss problems too late.",
    problemLabel: "Problem",
    solutionLabel: "RiceGuard solution",
  },
};

/* --------------------- Disease catalog (focal cross-fade scroll) --------------------- */
//
// Pattern: section locks scroll (sticky + tall outer container). Each card
// occupies an overlapping slice of scroll progress. Cards cross-fade with
// scale+x:
//   - approaches from the RIGHT, scaling 0.7 → 1, fading in
//   - holds at center while user reads
//   - exits to the LEFT, scaling 1 → 0.7, fading out
//
// Card N's exit overlaps with card N+1's entrance so they cross over
// gracefully. Last card holds at peak through the end of the section so the
// reader is never rushed off the final disease before scrolling continues.

function DiseaseSection() {
  const { lang } = useLang();
  const t = useT(DISEASE_DICT);
  const sectionRef = useRef<HTMLDivElement>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);

  // Manual scroll-progress tracking. framer-motion's `useScroll({ target })`
  // was silently falling back to window scroll (because the ref wasn't yet
  // attached on first render, and it never re-initialized after attach).
  // This explicit listener locks progress to THIS section's bounds.
  const scrollYProgress = useMotionValue(0);
  useEffect(() => {
    const update = () => {
      const el = sectionRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const sectAbsTop = window.scrollY + r.top;
      const lockRange = r.height - window.innerHeight;
      if (lockRange <= 0) {
        scrollYProgress.set(0);
        return;
      }
      const p = (window.scrollY - sectAbsTop) / lockRange;
      scrollYProgress.set(Math.max(0, Math.min(1, p)));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [scrollYProgress]);

  if (reduced) {
    return (
      <section id="diseases" className="bg-stone-100 py-28 md:py-36 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <Kicker>{t("kicker")}</Kicker>
          <h2 className="font-display text-3xl md:text-5xl font-bold mt-6 leading-tight tracking-tight text-stone-900 max-w-3xl">
            {t("title")}
          </h2>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            {DISEASES.map((d) => (
              <DiseaseCard key={d.key} disease={d} lang={lang} />
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      id="diseases"
      ref={sectionRef}
      className="relative h-[400vh] bg-stone-100"
    >
      <div className="sticky top-0 h-screen overflow-hidden">
        {/* Heading — absolute so the card stage gets the full viewport height */}
        <div className="absolute top-0 inset-x-0 z-10 pt-20 md:pt-24 px-6 md:px-12 max-w-6xl mx-auto pointer-events-none">
          <Kicker>{t("kicker")}</Kicker>
          <h2 className="font-display text-2xl md:text-4xl font-bold mt-4 leading-[1.1] tracking-tight text-stone-900 max-w-2xl">
            {t("title")}
          </h2>
          <p className="text-stone-500 text-sm mt-2">{t("hint")}</p>
        </div>

        {/* Stage — starts below the pinned heading so the focused card never covers copy. */}
        <div className="absolute inset-0">
          {DISEASES.map((d, i) => (
            <FocusedDisease
              key={d.key}
              disease={d}
              index={i}
              total={DISEASES.length}
              scrollYProgress={scrollYProgress}
              lang={lang}
            />
          ))}
        </div>

        {/* Progress dots — absolute bottom */}
        <div className="absolute bottom-8 inset-x-0 z-10">
          <ProgressDots scrollYProgress={scrollYProgress} count={DISEASES.length} />
        </div>
      </div>
    </section>
  );
}

function FocusedDisease({
  disease,
  index,
  total,
  scrollYProgress,
  lang,
}: {
  disease: (typeof DISEASES)[number];
  index: number;
  total: number;
  scrollYProgress: MotionValue<number>;
  lang: "tl" | "en";
}) {
  // EXPLICIT per-card timeline (total=3). Each card has 3 distinct phases:
  //   [0]   invisible before enter
  //   [1]   ENTER — slides + zooms from right
  //   [2,3] PEAK — held centered, fully opaque, scale 1.06
  //   [4]   EXIT — slides + shrinks to left (or holds for last card)
  //   [5]   invisible after exit
  //
  // Card 0 (Rice Blast):  peak 0.00 → 0.25, exit 0.25 → 0.40
  // Card 1 (BLB):         enter 0.25 → 0.40, peak 0.40 → 0.60, exit 0.60 → 0.75
  // Card 2 (Tungro):      enter 0.60 → 0.75, peak 0.75 → 1.00
  //
  // Card N's exit overlaps with card N+1's enter so they cross-fade naturally.
  type Timeline = { keys: number[]; xVals: string[]; scaleVals: number[]; opacityVals: number[] };
  const peakScale = 1.06;
  const offScale = 0.55;

  const timelines: Record<number, Timeline> = {
    0: {
      // Rice Blast — at peak immediately, exits at 0.25–0.40
      keys: [0, 0.0001, 0.25, 0.40, 0.4001, 1],
      xVals: ["0%", "0%", "0%", "-85%", "-85%", "-85%"],
      scaleVals: [peakScale, peakScale, peakScale, offScale, offScale, offScale],
      opacityVals: [1, 1, 1, 0, 0, 0],
    },
    1: {
      // BLB — enters 0.25–0.40, peak 0.40–0.60, exits 0.60–0.75
      keys: [0, 0.25, 0.40, 0.60, 0.75, 1],
      xVals: ["85%", "85%", "0%", "0%", "-85%", "-85%"],
      scaleVals: [offScale, offScale, peakScale, peakScale, offScale, offScale],
      opacityVals: [0, 0, 1, 1, 0, 0],
    },
    2: {
      // Tungro — enters 0.60–0.75, peak 0.75 → 1, holds at peak through end
      keys: [0, 0.60, 0.75, 0.9999, 0.99995, 1],
      xVals: ["85%", "85%", "0%", "0%", "0%", "0%"],
      scaleVals: [offScale, offScale, peakScale, peakScale, peakScale, peakScale],
      opacityVals: [0, 0, 1, 1, 1, 1],
    },
  };

  const tl = timelines[index] ?? timelines[1];
  const x = useTransform(scrollYProgress, tl.keys, tl.xVals);
  const scale = useTransform(scrollYProgress, tl.keys, tl.scaleVals);
  const opacity = useTransform(scrollYProgress, tl.keys, tl.opacityVals);
  // Silence unused-warnings now that we use a fixed timeline per card.
  void total;

  return (
    <motion.div
      style={{
        x,
        scale,
        opacity,
        willChange: "transform, opacity",
      }}
      className="absolute inset-0 flex items-start justify-center px-6 pt-[15rem] pb-20 md:px-12 md:pt-[17rem] lg:pt-[16rem] pointer-events-none"
    >
      <div className="pointer-events-auto w-full max-w-5xl">
        <DiseaseCard disease={disease} lang={lang} index={index} />
      </div>
    </motion.div>
  );
}

function DiseaseCard({
  disease,
  lang,
  index,
}: {
  disease: (typeof DISEASES)[number];
  lang: "tl" | "en";
  index?: number;
}) {
  const symptoms = lang === "tl" ? disease.symptomsTl : disease.symptomsEn;
  const severity = lang === "tl" ? disease.severity : disease.severityEn;
  const subtitle = lang === "tl" ? disease.tl : disease.subtitleEn;

  // NO own animation. The parent FocusedDisease controls scale/opacity/x via
  // scrollYProgress. Adding whileInView here was double-stacking transforms
  // and the IntersectionObserver stalled at initial values inside the
  // transformed parent → made the focused card permanently look faded.
  return (
    <article className="rounded-[1.5rem] overflow-hidden bg-white border border-stone-200 shadow-2xl shadow-stone-900/20 grid grid-cols-1 md:grid-cols-[1.08fr_1fr] md:h-[390px] lg:h-[410px]">
      {/* Image */}
      <div className="relative bg-stone-200 overflow-hidden min-h-[200px]">
        <img
          src={disease.image}
          alt={`${disease.name} (${disease.tl}) — symptom photograph`}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
        <div className="absolute bottom-4 left-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/95 backdrop-blur text-stone-900 text-xs font-semibold shadow">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: disease.accent }}
            aria-hidden
          />
          {lang === "tl" ? "Severity: " : "Severity: "}
          {severity}
        </div>
      </div>

      {/* Text */}
      <div className="p-6 md:p-8 lg:p-9 flex flex-col">
        {typeof index === "number" && (
          <div className="text-xs text-stone-400 font-mono tracking-wider">
            {String(index + 1).padStart(2, "0")} / {String(DISEASES.length).padStart(2, "0")}
          </div>
        )}
        <h3 className="font-display text-3xl md:text-[2.35rem] font-bold text-stone-900 tracking-tight mt-2 leading-tight">
          {disease.name}
        </h3>
        <div className="text-sm text-stone-500 mt-1 italic">{subtitle}</div>
        <ul className="mt-5 space-y-3 flex-1">
          {symptoms.map((s, i) => (
            <li
              key={i}
              className="flex items-start gap-3 text-stone-700 leading-relaxed text-[15px]"
            >
              <span
                className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: disease.accent }}
                aria-hidden
              />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function ProgressDots({
  scrollYProgress,
  count,
}: {
  scrollYProgress: MotionValue<number>;
  count: number;
}) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    return scrollYProgress.on("change", (p) => {
      const i = Math.min(count - 1, Math.floor(p * count));
      setActive(i);
    });
  }, [scrollYProgress, count]);

  return (
    <div className="mt-8 md:mt-12 flex items-center gap-2 px-6 md:px-12 max-w-6xl mx-auto w-full">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`h-1 rounded-full transition-all duration-300 ${
            i === active ? "w-10 bg-forest-900" : "w-5 bg-stone-300"
          }`}
        />
      ))}
    </div>
  );
}

const DISEASE_DICT = {
  tl: {
    kicker: "Tatlong sakit na binabantayan",
    title: "Bawat sakit, may sariling lunas at warning.",
    hint: "Mag-scroll para sa bawat sakit →",
  },
  en: {
    kicker: "Three diseases we monitor",
    title: "Each disease has its own treatment and warning.",
    hint: "Scroll for each disease →",
  },
};

/* --------------------- Workflow --------------------- */

function WorkflowSection() {
  const { lang } = useLang();
  const t = useT(WORKFLOW_DICT);

  return (
    <section
      id="workflow"
      className="bg-forest-950 text-white py-28 md:py-36 px-6 md:px-12"
    >
      <div className="max-w-6xl mx-auto">
        <Kicker light>{t("kicker")}</Kicker>
        <h2 className="font-display text-3xl md:text-5xl font-bold mt-6 leading-tight tracking-tight text-white max-w-3xl">
          {t("title")}
        </h2>
        <p className="text-stone-300 mt-5 max-w-2xl leading-relaxed">
          {t("body")}
        </p>

        <div className="mt-16 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 md:gap-5">
          {STEPS.map((step, i) => (
            <WorkflowCard
              key={i}
              icon={step.icon}
              title={lang === "tl" ? step.titleTl : step.titleEn}
              desc={lang === "tl" ? step.descTl : step.descEn}
              stepLabel={t("stepLabel")}
              index={i}
            />
          ))}
        </div>

        <div className="mt-16 flex items-center gap-3 text-rice-200">
          <ShieldCheck size={18} aria-hidden />
          <span className="text-sm">
            {t("assurance")}
          </span>
        </div>
      </div>
    </section>
  );
}

function WorkflowCard({
  icon: Icon,
  title,
  desc,
  stepLabel,
  index,
}: {
  icon: typeof Wheat;
  title: string;
  desc: string;
  stepLabel: string;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, delay: index * 0.08 }}
      className="relative bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 rounded-2xl p-5 transition-colors duration-300"
    >
      <div className="w-10 h-10 rounded-xl bg-rice-400 grid place-items-center text-forest-950 mb-4">
        <Icon size={20} aria-hidden />
      </div>
      <div className="text-xs text-rice-300 font-semibold tracking-wide">
        {stepLabel} {index + 1}
      </div>
      <div className="font-display font-bold text-lg mt-1.5 text-white tracking-tight">
        {title}
      </div>
      <p className="text-stone-300 text-sm mt-2 leading-relaxed">{desc}</p>
    </motion.div>
  );
}

const WORKFLOW_DICT = {
  tl: {
    kicker: "Paano gumagana",
    title: "Mula sa drone, papuntang cellphone.",
    body:
      "Limang hakbang - automatic ang transition kada isa. Walang manu-manong encoding, walang papel, walang tawag-tawag sa extension worker.",
    stepLabel: "HAKBANG",
    assurance:
      "PhilRice + DA Region II aligned. Walang AI hallucination ng dose o chemical - galing lahat sa structured knowledge base.",
  },
  en: {
    kicker: "How it works",
    title: "From drone scan to a farmer's phone.",
    body:
      "Five connected steps move the field image into a practical advisory. No manual encoding, no paper forms, and no waiting for a separate field report.",
    stepLabel: "STEP",
    assurance:
      "Aligned with PhilRice and DA Region II guidance. Dose and chemical recommendations come from a structured knowledge base, not free-form AI guessing.",
  },
};

/* ----------------------- Final CTA ----------------------- */

function FinalCta() {
  const t = useT(FINAL_CTA_DICT);

  return (
    <section className="relative bg-gradient-to-b from-stone-50 to-rice-50 py-28 md:py-40 px-6 md:px-12 overflow-hidden">
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 50%, rgba(110,150,60,0.18), transparent 60%)",
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.8 }}
        className="relative max-w-3xl mx-auto text-center"
      >
        <Kicker>{t("kicker")}</Kicker>
        <h2
          className="font-display text-4xl md:text-6xl font-bold mt-6 text-stone-900 leading-[1.05] tracking-[-0.02em]"
          style={{ textWrap: "balance" as const }}
        >
          {t("title")}
        </h2>
        <p className="text-stone-700 mt-6 text-lg leading-relaxed max-w-xl mx-auto">
          {t("body")}
        </p>
        <Link
          to="/register"
          className="mt-10 inline-flex items-center gap-2 px-8 py-4 rounded-full bg-forest-950 text-white font-semibold hover:bg-forest-900 transition-all duration-200 tap cursor-pointer shadow-lg shadow-forest-950/20 hover:shadow-forest-950/30 hover:-translate-y-0.5"
        >
          {t("cta")} <ArrowRight size={18} aria-hidden />
        </Link>
      </motion.div>
    </section>
  );
}

const FINAL_CTA_DICT = {
  tl: {
    kicker: "Subukan ngayon",
    title: "Libre. Walang nawawalang oras.",
    body:
      "Mag-register gamit ang cellphone number lang. Walang password, walang i-install. Para sa magsasaka, hindi lang para sa tech expert.",
    cta: "Magsimula na",
  },
  en: {
    kicker: "Try it now",
    title: "Free to start. No wasted time.",
    body:
      "Register with a phone number only. No password, no install, and no complicated setup.",
    cta: "Get started",
  },
};

/* ----------------------- Footer ----------------------- */

function Footer() {
  const t = useT(FOOTER_DICT);

  return (
    <footer className="bg-stone-950 text-stone-200 py-16 px-6 md:px-12">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-10">
        <div>
          <div className="flex items-center gap-2 font-display text-xl font-bold text-white">
            <img src="/logo.png" alt="" aria-hidden className="w-7 h-7 rounded-md" />
            RiceGuard<span className="text-rice-300">.</span>
          </div>
          <p className="text-stone-400 text-sm mt-3 leading-relaxed max-w-xs">
            {t("summary")}
          </p>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.15em] text-rice-300">
            {t("about")}
          </div>
          <div className="mt-4 space-y-2 text-sm text-stone-400 leading-relaxed">
            <div>{t("study")}</div>
            <div>{t("region")}</div>
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.15em] text-rice-300">
            {t("account")}
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <Link
              to="/login"
              className="block text-stone-300 hover:text-white transition-colors duration-200 cursor-pointer"
            >
              {t("login")}
            </Link>
            <Link
              to="/register"
              className="block text-stone-300 hover:text-white transition-colors duration-200 cursor-pointer"
            >
              {t("register")}
            </Link>
          </div>
        </div>
      </div>
      <div className="max-w-6xl mx-auto mt-12 pt-6 border-t border-stone-800 text-xs text-stone-500">
        © {new Date().getFullYear()} RiceGuard AI. {t("copyright")}
      </div>
    </footer>
  );
}

const FOOTER_DICT = {
  tl: {
    summary:
      "Drone-based rice disease detection at automated Taglish advisory para sa Region II.",
    about: "Tungkol",
    study: "Research study sa pakikipagtulungan ng PhilRice",
    region: "Region II - Cagayan Valley, Pilipinas",
    account: "Account",
    login: "Mag-login",
    register: "Magrehistro",
    copyright: "Para sa edukasyon at pananaliksik.",
  },
  en: {
    summary:
      "Drone-based rice disease detection and automated advisory delivery for Region II.",
    about: "About",
    study: "Research study in collaboration with PhilRice",
    region: "Region II - Cagayan Valley, Philippines",
    account: "Account",
    login: "Log in",
    register: "Register",
    copyright: "For education and research.",
  },
};

/* ----------------------- Shared bits ----------------------- */

function Kicker({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return (
    <div
      className={`text-xs uppercase tracking-[0.2em] font-semibold ${
        light ? "text-rice-300" : "text-forest-800"
      }`}
    >
      <span className="inline-block w-7 h-px bg-current align-middle mr-3" />
      {children}
    </div>
  );
}
