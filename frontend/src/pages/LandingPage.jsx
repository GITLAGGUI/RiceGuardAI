import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useScroll, useTransform, useSpring, useMotionValueEvent } from 'framer-motion';
import Lenis from 'lenis';
import {
  ArrowRight, ArrowUpRight, Menu, X, ChevronDown,
  ScanLine, Target, Zap, ShieldCheck, Leaf, BarChart3,
  Globe, ExternalLink, Mail,
} from 'lucide-react';

const MotionDiv = motion.div;

const journeySteps = [
  {
    id: 0,
    title: 'Field Capture',
    subtitle: 'High-resolution drone telemetry',
    image: '/assets/drone_telemetry.png',
    copy: 'A streamlined drone flight maps your entire field in minutes. We capture the vital visual layers needed to understand crop health at a macro level.',
  },
  {
    id: 1,
    title: 'Disease Analysis',
    subtitle: 'Subtle canopy pattern recognition',
    image: '/assets/ai_diagnostics.png',
    copy: 'Our systems analyze the field map to identify early stress markers and disease zones. We cut through the noise to highlight exactly what requires your attention.',
  },
  {
    id: 2,
    title: 'Targeted Action',
    subtitle: 'GPS-guided crop intervention',
    image: '/assets/targeted_action.png',
    copy: 'Receive precise coordinates and practical advisories. Treat only the affected areas, saving resources and protecting your yield more effectively.',
  },
];

const diseaseTabs = [
  {
    id: 0,
    name: 'Rice Blast',
    image: '/assets/disease_blast.png',
    description: 'We detect lesion clusters early, allowing you to establish a spray boundary before the infection compromises the wider canopy.',
    metrics: [
      { label: 'Primary Indicator', value: 'Lesion Clusters' },
      { label: 'Spread Risk', value: 'High' }
    ]
  },
  {
    id: 1,
    name: 'Bacterial Blight',
    image: '/assets/disease_blight.png',
    description: 'By identifying water-soaked streaks, we estimate the spread accurately to provide you with an exact dosage guide for the affected block.',
    metrics: [
      { label: 'Primary Indicator', value: 'Leaf Streaking' },
      { label: 'Spread Risk', value: 'Moderate' }
    ]
  },
  {
    id: 2,
    name: 'Tungro Virus',
    image: '/assets/disease_tungro.png',
    description: 'We spot the subtle orange-yellow discoloration zones indicative of Tungro, issuing vector warnings for leafhopper management.',
    metrics: [
      { label: 'Primary Indicator', value: 'Discoloration' },
      { label: 'Spread Risk', value: 'Severe' }
    ]
  },
];

// Reusable Copilot-style Scroll Section
const CopilotFeatureSection = ({ id, title, steps }) => {
  const containerRef = useRef(null);
  
  // We track the scroll progress of the entire section
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"]
  });

  const [activeIndex, setActiveIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    // Determine active index based on scroll progress
    // If there are 3 steps, progress goes 0 to 1.
    // 0 - 0.33 -> index 0
    // 0.33 - 0.66 -> index 1
    // 0.66 - 1.0 -> index 2
    const stepSize = 1 / steps.length;
    const index = Math.min(
      steps.length - 1,
      Math.floor(latest / stepSize)
    );
    setActiveIndex(index);
  });

  const desktopVariants = {
    "prev": { top: '5%', left: '0%', width: '15%', height: '20%', opacity: 1, borderRadius: '1.5rem', filter: 'blur(0px)' },
    "curr": { top: '15%', left: '10%', width: '80%', height: '70%', opacity: 1, borderRadius: '2rem', filter: 'blur(0px)' },
    "next": { top: '75%', left: '85%', width: '15%', height: '20%', opacity: 1, borderRadius: '1.5rem', filter: 'blur(0px)' },
    "hidden-prev": { top: '-20%', left: '-10%', width: '15%', height: '20%', opacity: 0, filter: 'blur(10px)' },
    "hidden-next": { top: '100%', left: '100%', width: '15%', height: '20%', opacity: 0, filter: 'blur(10px)' },
  };

  const mobileVariants = {
    "prev": { top: '5%', left: '5%', width: '20%', height: '15%', opacity: 1, borderRadius: '1rem', filter: 'blur(0px)' },
    "curr": { top: '20%', left: '5%', width: '90%', height: '50%', opacity: 1, borderRadius: '1.5rem', filter: 'blur(0px)' },
    "next": { top: '80%', left: '75%', width: '20%', height: '15%', opacity: 1, borderRadius: '1rem', filter: 'blur(0px)' },
    "hidden-prev": { top: '-20%', left: '5%', width: '20%', height: '15%', opacity: 0, filter: 'blur(10px)' },
    "hidden-next": { top: '110%', left: '75%', width: '20%', height: '15%', opacity: 0, filter: 'blur(10px)' },
  };

  const variants = isMobile ? mobileVariants : desktopVariants;

  return (
    <section id={id} ref={containerRef} className="relative bg-[#090E0B]">
      <div className="w-full max-w-[1600px] mx-auto px-6 lg:px-12 pt-24 pb-12 flex justify-start">
        <h2 className="font-headline text-[2.5rem] font-medium text-white md:text-[3.5rem] leading-tight z-30 relative">
          {title}
        </h2>
      </div>

      <div className="relative flex flex-col lg:flex-row w-full max-w-[1600px] mx-auto px-6 lg:px-12">
        {/* Left Side: Sticky Images */}
        <div className="w-full lg:w-3/5 h-[60vh] lg:h-screen sticky top-0 lg:top-0 pt-0 lg:pt-24 flex items-start justify-center">
          <div className="relative w-full h-full max-h-[800px]">
            {steps.map((step, index) => {
              let state = "hidden";
              if (index === activeIndex - 1) state = "prev";
              else if (index === activeIndex) state = "curr";
              else if (index === activeIndex + 1) state = "next";
              else if (index < activeIndex - 1) state = "hidden-prev";
              else state = "hidden-next";

              return (
                <MotionDiv
                  key={`img-${index}`}
                  initial={false}
                  animate={state}
                  variants={variants}
                  transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute overflow-hidden shadow-2xl bg-[#1a231c]"
                  style={{ zIndex: state === "curr" ? 20 : 10 }}
                >
                  <img 
                    src={step.image} 
                    alt={step.title || step.name} 
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/10 pointer-events-none" />
                </MotionDiv>
              );
            })}
          </div>
        </div>

        {/* Right Side: Scrollable Text Blocks */}
        <div className="w-full lg:w-2/5 relative z-30 lg:pl-16 pb-[30vh]">
          {steps.map((step, index) => (
            <div 
              key={`text-block-${index}`} 
              className={`min-h-[50vh] lg:min-h-screen flex flex-col justify-center py-12 lg:py-0 transition-opacity duration-500 ${index === activeIndex ? 'opacity-100' : 'opacity-30'}`}
            >
              <span className="text-sm font-medium tracking-widest text-[#B4D693] mb-4 uppercase drop-shadow-md">
                {String(index + 1).padStart(2, '0')} — {step.title || "Disease Identification"}
              </span>
              <h3 className="font-headline text-3xl lg:text-4xl font-normal leading-[1.2] text-white mb-6 drop-shadow-md">
                {step.subtitle || step.name}
              </h3>
              <p className="text-lg font-light leading-relaxed text-white/80 drop-shadow-md">
                {step.copy || step.description}
              </p>
              
              {/* For Diagnostics section metrics */}
              {step.metrics && (
                <div className="mt-8 grid grid-cols-2 gap-6 border-t border-white/20 pt-6">
                  {step.metrics.map((metric, i) => (
                    <div key={i}>
                      <p className="text-xs font-medium uppercase tracking-widest text-white/60 drop-shadow-md">{metric.label}</p>
                      <p className="mt-1 text-base text-white drop-shadow-md">{metric.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// Dynamic text section simulating typing pop-ins
const DynamicTextSection = () => {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  
  const [index, setIndex] = useState(0);
  
  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    if (latest < 0.40) setIndex(0);
    else if (latest < 0.60) setIndex(1);
    else setIndex(2);
  });

  const phrases = [
    { 
      action: { icon: "🚁", text: "scan" }, 
      object: { icon: "🌾", text: "rice field" }, 
      purpose: { icon: "📍", text: "farm" } 
    },
    { 
      action: { icon: "🔍", text: "analyze" }, 
      object: { icon: "🦠", text: "heat map" }, 
      purpose: { icon: "📊", text: "crop" } 
    },
    { 
      action: { icon: "🎯", text: "generate" }, 
      object: { icon: "📋", text: "treatment" }, 
      purpose: { icon: "📈", text: "yield" } 
    },
  ];

  const current = phrases[index];

  const DynamicWord = ({ item, keyIndex }) => (
    <span className="relative inline-flex items-center justify-center overflow-hidden align-bottom px-2">
      <AnimatePresence>
        <MotionDiv
          key={keyIndex}
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={{ y: "-100%", opacity: 0, position: "absolute", left: "0.5rem" }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center gap-2 lg:gap-3 whitespace-nowrap"
        >
          <span className="text-3xl lg:text-5xl">{item.icon}</span>
          <span className="text-white font-semibold">{item.text}</span>
        </MotionDiv>
      </AnimatePresence>
    </span>
  );

  return (
    <section ref={ref} className="relative h-[250vh] bg-[#121212]">
      <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden">
        <div className="text-center px-6 w-full max-w-5xl flex flex-col items-center">
          <p className="mb-6 text-xl font-medium text-white/80">It's as easy as typing...</p>
          <div className="flex flex-col items-center justify-center font-headline text-[2.5rem] font-medium leading-[1.3] text-white/70 md:text-[3.5rem] lg:text-[4.5rem]">
            <div className="flex items-center flex-wrap justify-center gap-x-2">
              I want to <DynamicWord item={current.action} keyIndex={`action-${index}`} />
            </div>
            <div className="flex items-center flex-wrap justify-center gap-x-2">
              a <DynamicWord item={current.object} keyIndex={`object-${index}`} />
            </div>
            <div className="flex items-center flex-wrap justify-center gap-x-2">
              for my <DynamicWord item={current.purpose} keyIndex={`purpose-${index}`} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

// Animated stat counter
const AnimatedStat = ({ value, suffix = '', label }) => {
  const ref = useRef(null);
  const [isInView, setIsInView] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsInView(true); },
      { rootMargin: '-100px', threshold: 0.1 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isInView) return;
    let start = 0;
    const end = parseInt(value);
    const duration = 2000;
    const stepTime = Math.max(Math.floor(duration / end), 16);
    const timer = setInterval(() => {
      start += Math.ceil(end / (duration / stepTime));
      if (start >= end) { setCount(end); clearInterval(timer); }
      else setCount(start);
    }, stepTime);
    return () => clearInterval(timer);
  }, [isInView, value]);

  return (
    <div ref={ref} className="text-center">
      <p className="font-headline text-[3rem] md:text-[4rem] font-semibold text-white leading-none">
        {isInView ? count : 0}{suffix}
      </p>
      <p className="mt-3 text-sm font-medium uppercase tracking-widest text-white/50">{label}</p>
    </div>
  );
};

// Fade-in-up wrapper
const FadeIn = ({ children, delay = 0, className = '' }) => (
  <MotionDiv
    initial={{ opacity: 0, y: 30 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: '-80px' }}
    transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
    className={className}
  >
    {children}
  </MotionDiv>
);

const LandingPage = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Smooth scroll init
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.5,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1.2,
    });

    let frame;
    function raf(time) {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    }
    frame = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  // Navbar scroll detection
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Hero Parallax
  const heroRef = useRef(null);
  const { scrollYProgress: heroScroll } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const smoothHeroScroll = useSpring(heroScroll, { stiffness: 100, damping: 30 });
  const heroScale = useTransform(smoothHeroScroll, [0, 1], [1, 1.05]);
  const heroOpacity = useTransform(smoothHeroScroll, [0, 0.8], [1, 0]);
  const heroY = useTransform(smoothHeroScroll, [0, 1], ['0%', '30%']);

  const navLinks = [
    { href: '#workflow', label: 'Approach' },
    { href: '#diagnostics', label: 'Analysis' },
    { href: '#impact', label: 'Platform' },
  ];

  return (
    <main className="film-grain min-h-screen bg-[#090E0B] font-body text-[#F2F4EF] selection:bg-[#B4D693] selection:text-[#090E0B]">
      
      {/* ── Navigation ── */}
      <nav className={`fixed top-0 z-[100] w-full px-6 lg:px-12 transition-all duration-500 ${scrolled ? 'py-4 bg-[#090E0B]/80 backdrop-blur-xl border-b border-white/5' : 'py-6 bg-transparent'}`}>
        <div className="mx-auto flex max-w-[1600px] items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <img src="/assets/logo.png" alt="RiceGuard" className="h-9 w-auto object-contain" />
            <span className="font-headline text-lg font-medium tracking-wide">RiceGuard</span>
          </Link>

          <div className="hidden items-center gap-10 text-sm font-medium tracking-wide md:flex">
            {navLinks.map(l => (
              <a key={l.href} href={l.href} className="text-white/60 transition-colors duration-300 hover:text-white">{l.label}</a>
            ))}
          </div>

          <div className="flex items-center gap-4">
            <Link to="/login" className="hidden text-sm font-medium text-white/60 transition hover:text-white md:block">Log in</Link>
            <Link to="/register" className="hidden rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-[#090E0B] transition-all duration-300 hover:bg-[#B4D693] hover:shadow-lg hover:shadow-[#B4D693]/20 md:block">
              Request Access
            </Link>
            <button className="md:hidden text-white/80" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </nav>

      {/* ── Mobile Menu Panel ── */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <MotionDiv
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-x-0 top-0 z-[99] bg-[#090E0B]/95 backdrop-blur-2xl pt-24 pb-10 px-8 md:hidden"
          >
            <div className="flex flex-col gap-6">
              {navLinks.map(l => (
                <a key={l.href} href={l.href} onClick={() => setMobileMenuOpen(false)} className="text-2xl font-headline font-medium text-white/80 hover:text-white transition">{l.label}</a>
              ))}
              <hr className="border-white/10" />
              <Link to="/login" onClick={() => setMobileMenuOpen(false)} className="text-lg text-white/60 hover:text-white transition">Log in</Link>
              <Link to="/register" onClick={() => setMobileMenuOpen(false)} className="mt-2 rounded-full bg-white px-6 py-3 text-center text-base font-semibold text-[#090E0B]">Request Access</Link>
            </div>
          </MotionDiv>
        )}
      </AnimatePresence>

      {/* ── Hero Section ── */}
      <section ref={heroRef} className="relative isolate h-screen overflow-hidden bg-[#090E0B]">
        <MotionDiv style={{ scale: heroScale, opacity: heroOpacity }} className="absolute inset-0 -z-20">
          <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: 'url(/assets/hero-bg-new.png)' }} />
        </MotionDiv>
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#090E0B] via-[#090E0B]/50 to-[#090E0B]/20" />

        <MotionDiv style={{ y: heroY }} className="mx-auto flex h-full max-w-[1600px] flex-col justify-end px-6 pb-28 lg:px-12 lg:pb-36">
          <FadeIn>
            <div className="max-w-4xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-[#B4D693]/30 bg-[#B4D693]/10 px-4 py-1.5 text-xs font-medium tracking-widest text-[#B4D693] uppercase mb-8">
                <Leaf size={14} /> AI-Powered Crop Protection
              </span>
              <h1 className="font-headline text-[3.2rem] font-medium leading-[1.05] tracking-tight text-white md:text-[6rem]">
                Elevating crop<br />intelligence.
              </h1>
              <p className="mt-8 max-w-2xl text-lg leading-relaxed text-white/70 font-light md:text-xl">
                By combining aerial telemetry with deep field analysis, we provide a clearer, more actionable understanding of your rice fields.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <Link to="/register" className="group inline-flex items-center gap-3 rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-[#090E0B] transition-all duration-300 hover:bg-[#B4D693] hover:shadow-lg hover:shadow-[#B4D693]/25">
                  Get Started <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                </Link>
                <a href="#workflow" className="group inline-flex items-center gap-2 rounded-full border border-white/20 px-8 py-3.5 text-sm font-medium text-white/80 transition-all duration-300 hover:border-white/50 hover:text-white">
                  See how it works
                </a>
              </div>
            </div>
          </FadeIn>
        </MotionDiv>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-white/40 animate-gentle-bounce">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em]">Scroll</span>
          <ChevronDown size={18} />
        </div>
      </section>

      <DynamicTextSection />

      <CopilotFeatureSection id="workflow" title="The Process" steps={journeySteps} />

      <CopilotFeatureSection id="diagnostics" title="Analysis" steps={diseaseTabs} />

      {/* ── Stats Section ── */}
      <section className="relative bg-[#090E0B] py-28 lg:py-36 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0d1a10]/50 to-transparent pointer-events-none" />
        <div className="mx-auto max-w-[1600px] px-6 lg:px-12 relative z-10">
          <FadeIn>
            <p className="text-center text-sm font-medium uppercase tracking-[0.25em] text-[#B4D693]/70 mb-16">Platform Performance</p>
          </FadeIn>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-12 lg:gap-8">
            <AnimatedStat value="95" suffix="%" label="Detection Accuracy" />
            <AnimatedStat value="12" suffix="k+" label="Scans Processed" />
            <AnimatedStat value="40" suffix="%" label="Yield Loss Prevented" />
            <AnimatedStat value="3" suffix="s" label="Avg. Analysis Time" />
          </div>
        </div>
      </section>

      {/* ── Impact / CTA Section ── */}
      <section id="impact" className="relative bg-[#090E0B] py-32 lg:py-48 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-[#B4D693]/5 blur-[150px]" />
        </div>
        <div className="mx-auto max-w-[1600px] px-6 lg:px-12 relative z-10">
          <FadeIn>
            <div className="mx-auto max-w-4xl text-center">
              <h2 className="font-headline text-[2.8rem] font-medium leading-[1.08] tracking-tight text-white md:text-[4.5rem]">
                A modern standard for agricultural precision.
              </h2>
              <p className="mt-8 mx-auto max-w-2xl text-lg font-light leading-relaxed text-white/60">
                We believe in providing farmers with clarity, not complexity. See how our telemetry can safeguard your next harvest.
              </p>
            </div>
          </FadeIn>

          {/* Glass CTA Card */}
          <FadeIn delay={0.2}>
            <div className="mt-20 mx-auto max-w-3xl rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-10 md:p-14">
              <div className="grid md:grid-cols-2 gap-10 items-center">
                <div>
                  <h3 className="font-headline text-2xl font-medium text-white">Ready to protect your fields?</h3>
                  <p className="mt-4 text-sm leading-relaxed text-white/50">
                    Join the growing network of Filipino farmers using AI-powered diagnostics to secure their harvests.
                  </p>
                </div>
                <div className="flex flex-col gap-3">
                  <Link to="/register" className="group flex items-center justify-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-[#090E0B] transition-all duration-300 hover:bg-[#B4D693] hover:shadow-lg hover:shadow-[#B4D693]/25">
                    Request Access <ArrowUpRight size={16} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </Link>
                  <Link to="/login" className="flex items-center justify-center rounded-full border border-white/15 px-8 py-3.5 text-sm font-medium text-white/70 transition hover:border-white/30 hover:text-white">
                    Sign in to dashboard
                  </Link>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/5 bg-[#060a07]">
        <div className="mx-auto max-w-[1600px] px-6 lg:px-12 py-16 lg:py-20">
          <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-4">
            {/* Brand */}
            <div className="lg:col-span-1">
              <Link to="/" className="flex items-center gap-3">
                <img src="/assets/logo.png" alt="RiceGuard" className="h-8 w-auto object-contain opacity-80" />
                <span className="font-headline text-lg font-medium text-white/90">RiceGuard</span>
              </Link>
              <p className="mt-5 text-sm leading-relaxed text-white/40 max-w-xs">
                Precision disease management powered by drone telemetry and deep learning, built for Filipino rice farmers.
              </p>
            </div>

            {/* Links */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/30 mb-5">Platform</h4>
              <ul className="space-y-3">
                <li><a href="#workflow" className="text-sm text-white/50 hover:text-white transition">How it works</a></li>
                <li><a href="#diagnostics" className="text-sm text-white/50 hover:text-white transition">Disease Analysis</a></li>
                <li><a href="#impact" className="text-sm text-white/50 hover:text-white transition">Get Started</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/30 mb-5">Account</h4>
              <ul className="space-y-3">
                <li><Link to="/login" className="text-sm text-white/50 hover:text-white transition">Sign in</Link></li>
                <li><Link to="/register" className="text-sm text-white/50 hover:text-white transition">Register</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/30 mb-5">Connect</h4>
              <div className="flex items-center gap-4">
                <a href="#" className="text-white/30 hover:text-white/70 transition"><Globe size={18} /></a>
                <a href="#" className="text-white/30 hover:text-white/70 transition"><ExternalLink size={18} /></a>
                <a href="#" className="text-white/30 hover:text-white/70 transition"><Mail size={18} /></a>
              </div>
            </div>
          </div>

          <div className="mt-16 pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-xs text-white/25">© {new Date().getFullYear()} RiceGuard AI. All rights reserved.</p>
            <p className="text-xs text-white/25">Built with 🌾 for Filipino farmers.</p>
          </div>
        </div>
      </footer>

    </main>
  );
};

export default LandingPage;

