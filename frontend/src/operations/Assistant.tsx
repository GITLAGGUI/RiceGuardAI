// GABAY: Ang chat assistant (mascot sa kanang ibaba ng public pages). Tumatawag sa edge function na public-assistant.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, HelpCircle, Send, Sparkles, X } from "lucide-react";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { useSmsRegistrationStatus } from "./registrationStatus";

type AssistantSection = { heading?: string; body?: string; bullets?: string[] };
type AssistantReply = { intro: string; sections: AssistantSection[]; closing?: string };
type ChatEntry = { id: string; role: "user" | "assistant"; text?: string; reply?: AssistantReply };

const prompts = [
  "Kumusta, ka-farmer! May maitutulong ba ako?",
  "Magtanong tungkol sa BLB, Brown Spot, mapa, o SMS alerts.",
  "Nandito ako para gawing mas malinaw ang field updates.",
];

const welcome: AssistantReply = {
  intro: "Mabuhay! Ako ang RiceGuardAI Assistant.",
  sections: [{
    body: "Pwede mo akong tanungin tungkol sa field bulletin, monitoring map, SMS alerts, Bacterial Leaf Blight, at Brown Spot.",
  }],
  closing: "Simple at natural na Tagalog ang gagamitin ko.",
};

export function openRiceGuardAssistant() {
  window.dispatchEvent(new CustomEvent("riceguard:assistant-open"));
}

export function AssistantWidget({ compact = false, launcher = true }: { compact?: boolean; launcher?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [promptIndex, setPromptIndex] = useState(0);
  const [entries, setEntries] = useState<ChatEntry[]>([
    { id: "welcome", role: "assistant", reply: welcome },
  ]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const listener = () => setOpen(true);
    window.addEventListener("riceguard:assistant-open", listener);
    return () => window.removeEventListener("riceguard:assistant-open", listener);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setPromptIndex((current) => (current + 1) % prompts.length), 4600);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: "end" }); }, [open, entries, busy]);

  const conversation = useMemo(() => entries.slice(-8).map((entry) => ({
    role: entry.role,
    content: entry.text || entry.reply?.intro || "",
  })), [entries]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    setDraft("");
    setEntries((current) => [...current, { id: crypto.randomUUID(), role: "user", text: message }]);
    setBusy(true);
    try {
      if (!supabaseConfigured) throw new Error("Hindi available ang assistant ngayon.");
      const { data, error } = await supabase.functions.invoke("public-assistant", {
        body: { message, conversation },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Hindi nakasagot ang assistant.");
      setEntries((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        reply: data.answer as AssistantReply,
      }]);
    } catch (error) {
      setEntries((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        reply: {
          intro: "Pasensya, hindi ako makakonekta ngayon.",
          sections: [{ body: error instanceof Error ? error.message : "Pakisubukan muli maya-maya." }],
          closing: "Maaari mo pa ring buksan ang Field Bulletin at Monitoring Map.",
        },
      }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rg-assistant ${compact ? "compact" : ""} ${open ? "open" : ""}`}>
      {!open && launcher ? (
        <button className="rg-assistant-launcher" onClick={() => setOpen(true)} aria-label="Buksan ang RiceGuardAI Assistant">
          <img src="/images/mascot/assistant-glasses-v1.png" alt="" />
          <span key={promptIndex}>{prompts[promptIndex]}</span>
        </button>
      ) : open ? (
        <section className="rg-assistant-panel" role="dialog" aria-label="RiceGuardAI Assistant">
          <header>
            <span className="rg-assistant-avatar"><img src="/images/mascot/assistant-glasses-v1.png" alt="" /><i aria-hidden="true" /></span>
            <div><strong>RiceGuardAI Assistant</strong></div>
            <button onClick={() => setOpen(false)} aria-label="Isara ang assistant"><X size={20} /></button>
          </header>
          <div className="rg-assistant-messages" aria-live="polite">
            {entries.map((entry) => entry.role === "user" ? (
              <div key={entry.id} className="rg-chat-user">{entry.text}</div>
            ) : (
              <article key={entry.id} className="rg-chat-assistant">
                <strong>{entry.reply?.intro}</strong>
                {entry.reply?.sections?.map((section, index) => (
                  <section key={`${entry.id}-${index}`}>
                    {section.heading ? <h3>{section.heading}</h3> : null}
                    {section.body ? <p>{section.body}</p> : null}
                    {section.bullets?.length ? <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul> : null}
                  </section>
                ))}
                {entry.reply?.closing ? <p className="rg-chat-closing">{entry.reply.closing}</p> : null}
              </article>
            ))}
            {busy ? <div className="rg-chat-thinking"><Sparkles size={16} /> Nag-iisip…</div> : null}
            <div ref={endRef} />
          </div>
          <div className="rg-assistant-suggestions">
            {["Ano ang BLB?", "Paano ang SMS alerts?", "Buksan ang mapa"].map((suggestion) => (
              <button key={suggestion} onClick={() => setDraft(suggestion)}>{suggestion}</button>
            ))}
          </div>
          <form onSubmit={submit}>
            <label className="sr-only" htmlFor="riceguard-assistant-message">Mensahe</label>
            <textarea
              id="riceguard-assistant-message"
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, 600))}
              placeholder="Magtanong sa simpleng Tagalog…"
              rows={2}
            />
            <button disabled={!draft.trim() || busy} aria-label="Ipadala"><Send size={18} /></button>
          </form>
          <small className="rg-assistant-note">Gabay lamang ito. Para sa diagnosis, kumonsulta sa agriculture specialist.</small>
        </section>
      ) : null}
    </div>
  );
}

export type TourStep = {
  id: "filters" | "feed" | "navigation";
  target: string;
  title: string;
  text: string;
  placement: "top" | "bottom" | "left" | "right";
};

const TOUR_KEY = "riceguard-bulletin-tour-v2";

export function getBulletinTourSteps(registered: boolean, hasAdvisories: boolean): TourStep[] {
  return [
    {
      id: "filters",
      target: "[data-tour='filters']",
      title: "Maghanap ng advisory",
      text: "Gamitin ang search at filters para pumili ng sakit, lugar, o petsa.",
      placement: "bottom",
    },
    {
      id: "feed",
      target: "[data-tour='feed']",
      title: hasAdvisories ? "Basahin ang field update" : "Dito lalabas ang field updates",
      text: hasAdvisories
        ? "Buksan ang detalye ng advisory. Maaari rin itong i-save o ibahagi gamit ang mga button sa post."
        : "Kapag may approved advisory, dito ito lalabas. Walang sample post na ipinapakita bilang tunay na field update.",
      placement: "right",
    },
    {
      id: "navigation",
      target: "[data-tour='navigation']",
      title: "Mapa at SMS alerts",
      text: registered
        ? "Buksan ang Monitoring Map o SMS Preferences mula sa navigation."
        : "Buksan ang Monitoring Map o SMS Registration mula sa navigation.",
      placement: "right",
    },
  ];
}

export function openBulletinWalkthrough() {
  window.dispatchEvent(new CustomEvent("riceguard:bulletin-tour-open"));
}

function visibleTarget(selector: string) {
  return [...document.querySelectorAll<HTMLElement>(selector)].find((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }) || null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function BulletinWalkthrough({ hasAdvisories }: { hasAdvisories: boolean }) {
  const registered = useSmsRegistrationStatus();
  const steps = useMemo(() => getBulletinTourSteps(registered, hasAdvisories), [hasAdvisories, registered]);
  const [step, setStep] = useState(() => {
    try { return localStorage.getItem(TOUR_KEY) ? -1 : 0; } catch { return -1; }
  });
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 720px)").matches);
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    try { localStorage.setItem(TOUR_KEY, "done"); } catch { /* no-op */ }
    setStep(-1);
    setTargetRect(null);
    window.setTimeout(() => restoreFocusRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    const replay = () => {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setStep(0);
    };
    window.addEventListener("riceguard:bulletin-tour-open", replay);
    return () => window.removeEventListener("riceguard:bulletin-tour-open", replay);
  }, []);

  useEffect(() => {
    if (step < 0) return;
    if (!restoreFocusRef.current && document.activeElement instanceof HTMLElement) {
      restoreFocusRef.current = document.activeElement;
    }
    const current = steps[step];
    if (!current) {
      const timer = window.setTimeout(close, 0);
      return () => window.clearTimeout(timer);
    }
    const target = visibleTarget(current.target);
    if (!target) {
      const timer = window.setTimeout(() => {
        setStep((value) => value >= steps.length - 1 ? -1 : value + 1);
      }, 80);
      return () => window.clearTimeout(timer);
    }
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "center", inline: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
    const frame = window.requestAnimationFrame(() => setTargetRect(target.getBoundingClientRect()));
    const focusTimer = window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>("[data-tour-primary]")?.focus(), reducedMotion ? 0 : 260);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(focusTimer);
    };
  }, [close, step, steps]);

  useEffect(() => {
    if (step < 0) return;
    const reposition = () => {
      setMobile(window.matchMedia("(max-width: 720px)").matches);
      const current = steps[step];
      const target = current ? visibleTarget(current.target) : null;
      if (target) setTargetRect(target.getBoundingClientRect());
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("orientationchange", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("orientationchange", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [step, steps]);

  if (step < 0 || !targetRect || !steps[step]) return null;
  const item = steps[step];
  const highlightStyle: CSSProperties = {
    top: targetRect.top - 7,
    left: targetRect.left - 7,
    width: targetRect.width + 14,
    height: targetRect.height + 14,
  };
  const cardWidth = Math.min(380, window.innerWidth - 32);
  const cardHeight = 250;
  const gap = 16;
  let top = targetRect.bottom + gap;
  let left = targetRect.left;
  if (item.placement === "right") {
    top = targetRect.top;
    left = targetRect.right + gap;
  } else if (item.placement === "left") {
    top = targetRect.top;
    left = targetRect.left - cardWidth - gap;
  } else if (item.placement === "top") {
    top = targetRect.top - cardHeight - gap;
  }
  if (top + cardHeight > window.innerHeight - 16 && item.placement === "bottom") top = targetRect.top - cardHeight - gap;
  const cardStyle: CSSProperties = mobile ? {} : {
    top: clamp(top, 16, window.innerHeight - cardHeight - 16),
    left: clamp(left, 16, window.innerWidth - cardWidth - 16),
    width: cardWidth,
  };

  return createPortal(
    <div className="rg-tour-layer">
      <div className="rg-tour-dimmer" aria-hidden="true" />
      <div className="rg-tour-highlight" style={highlightStyle} aria-hidden="true" />
      <section
        ref={dialogRef}
        className={`rg-tour-card ${mobile ? "mobile" : ""}`}
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rg-tour-title"
        aria-describedby="rg-tour-description"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
          }
          if (event.key !== "Tab") return;
          const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") || [])];
          if (!focusable.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="rg-tour-progress" aria-hidden="true">{steps.map((tourStep, index) => <i key={tourStep.id} className={index <= step ? "active" : ""} />)}</div>
        <div className="rg-tour-meta"><HelpCircle size={20} /><span>{step + 1} of {steps.length}</span></div>
        <h2 id="rg-tour-title">{item.title}</h2>
        <p id="rg-tour-description">{item.text}</p>
        <div className="rg-tour-actions">
          <button className="rg-tour-skip" onClick={close}>Laktawan</button>
          <span />
          {step > 0 ? <button className="rg-tour-back" onClick={() => setStep(step - 1)}><ArrowLeft size={16} /> Bumalik</button> : null}
          <button data-tour-primary className="rg-button rg-primary" onClick={() => step === steps.length - 1 ? close() : setStep(step + 1)}>
            {step === steps.length - 1 ? "Tapos" : "Susunod"} {step < steps.length - 1 ? <ArrowRight size={17} /> : null}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
