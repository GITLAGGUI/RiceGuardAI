import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowRight, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { supabase, supabaseConfigured } from "@/lib/supabase";

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

const tourSteps = [
  { title: "Hanapin ang field update", text: "Gamitin ang search at filters para sa sakit, lugar, at petsa." },
  { title: "Basahin at i-save", text: "Buksan ang detalye, i-save ang mahalagang advisory, o ibahagi ang link." },
  { title: "Mapa at SMS", text: "Tingnan ang approximate monitoring areas at i-register ang farm para sa relevant SMS alerts." },
];

export function BulletinWalkthrough() {
  const [step, setStep] = useState(() => {
    try {
      return localStorage.getItem("riceguard-bulletin-tour-v1") ? -1 : 0;
    } catch {
      return -1;
    }
  });
  const finish = () => {
    try { localStorage.setItem("riceguard-bulletin-tour-v1", "done"); } catch { /* no-op */ }
    setStep(-1);
  };
  if (step < 0) return null;
  const item = tourSteps[step];
  return (
    <div className="rg-tour-backdrop" role="dialog" aria-modal="true" aria-label="Bulletin walkthrough">
      <section className="rg-tour-card">
        <div className="rg-tour-progress">{tourSteps.map((_, index) => <i key={index} className={index <= step ? "active" : ""} />)}</div>
        <MessageCircle size={27} />
        <small>QUICK GUIDE · {step + 1} OF {tourSteps.length}</small>
        <h2>{item.title}</h2>
        <p>{item.text}</p>
        <div>
          <button className="rg-tour-skip" onClick={finish}>Laktawan</button>
          <button className="rg-button rg-primary" onClick={() => step === tourSteps.length - 1 ? finish() : setStep(step + 1)}>
            {step === tourSteps.length - 1 ? "Simulan" : "Susunod"} <ArrowRight size={17} />
          </button>
        </div>
      </section>
    </div>
  );
}
