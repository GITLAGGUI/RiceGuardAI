import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, MapPin, Play } from "lucide-react";
import { BookmarkSimple as PhBookmark, ShareNetwork as PhShare } from "@phosphor-icons/react";
import type { Bulletin, Disease, PublicPhoto, WebSource } from "./domain";
import { DiseasePhoto, DISEASE_COLORS, DISEASE_NAMES } from "./DiseasePhoto";
import { VerificationBadge } from "./VerificationBadge";
import { advisoryActionSteps } from "./advisoryPresentation";

const LEVEL: Record<string, string> = { low: "Mababa", moderate: "Katamtaman", high: "Mataas" };

export function useBookmarks() {
  const read = () => { try { return JSON.parse(localStorage.getItem("riceguard-public-bookmarks") || "[]") as string[]; } catch { return []; } };
  const [bookmarks, setBookmarks] = useState<string[]>(read);
  useEffect(() => {
    const sync = () => setBookmarks(read());
    window.addEventListener("riceguard-bookmarks", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("riceguard-bookmarks", sync); window.removeEventListener("storage", sync); };
  }, []);
  const toggle = (id: string) => setBookmarks((current) => {
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    try { localStorage.setItem("riceguard-public-bookmarks", JSON.stringify(next)); } catch { /* private mode */ }
    queueMicrotask(() => window.dispatchEvent(new Event("riceguard-bookmarks")));
    return next;
  });
  return { bookmarks, toggle };
}

export const diseasesOf = (item: Bulletin): Disease[] => item.diseases?.length ? item.diseases : [item.disease];
export const stripCitations = (text: string) => text.replace(/\s*\[S\d+\]/g, "");

export function photosOf(item: Bulletin): PublicPhoto[] {
  if (item.media?.length) return item.media;
  return item.image ? [{ url: item.image, alt: `Larawan para sa ${item.title}`, type: "image" }] : [];
}

export function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value
    : new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

/** Disease chip with its legend colour and, for automated posts, the measured level. */
export function DiseaseChips({ item }: { item: Bulletin }) {
  return (
    <span className="rg-chips">
      {diseasesOf(item).map((disease) => {
        const s = item.severity_detail?.diseases?.[disease];
        return (
          <span key={disease} className="rg-chip">
            <i style={{ background: DISEASE_COLORS[disease] }} aria-hidden />
            {disease}{s ? <b className={`rg-sev-text is-${s.category}`}> · {LEVEL[s.category]}</b> : null}
          </span>
        );
      })}
    </span>
  );
}

function PhotoView({ photo, compact }: { photo: PublicPhoto; compact?: boolean }) {
  const [playing, setPlaying] = useState(false);
  if (photo.type === "video") {
    return (
      <div className="rg-disease-photo"><div className="rg-disease-stage" style={{ aspectRatio: "16 / 9" }}>
        <video src={photo.url} controls={playing} playsInline preload="metadata" muted={!playing} aria-label={photo.alt} />
        {!playing ? <button type="button" className="rg-tap-to-play" onClick={(e) => { setPlaying(true); void (e.currentTarget.previousElementSibling as HTMLVideoElement)?.play(); }}>
          <Play size={20} fill="currentColor" /> Panoorin</button> : null}
      </div></div>
    );
  }
  return <DiseasePhoto compact={compact} original={photo.original_url} layers={photo.layers} fallback={photo.url}
    alt={photo.alt} width={photo.width} height={photo.height} />;
}

export function BulletinCard({ item }: { item: Bulletin }) {
  const { bookmarks, toggle } = useBookmarks();
  const saved = bookmarks.includes(item.id);
  const photos = photosOf(item);
  const steps = advisoryActionSteps(item.action).slice(0, 2).map(stripCitations);
  const share = async () => {
    const url = `${location.origin}/advisories/${item.slug}`;
    try { if (navigator.share) await navigator.share({ title: item.title, url }); else await navigator.clipboard.writeText(url); }
    catch { /* dismissed */ }
  };
  return (
    <article className="rg-post3">
      {photos[0] ? (
        <div className="rg-post3-media">
          <PhotoView photo={photos[0]} compact />
          {photos.length > 1 ? <Link className="rg-post3-more" to={`/advisories/${item.slug}`}>+{photos.length - 1} larawan</Link> : null}
        </div>
      ) : null}
      <div className="rg-post3-body">
        <div className="rg-post3-meta">
          <DiseaseChips item={item} />
          <VerificationBadge status={item.verification_status} verifiedAt={item.verified_at} size="sm" />
        </div>
        <h2><Link to={`/advisories/${item.slug}`}>{stripCitations(item.title)}</Link></h2>
        <p className="rg-post3-place"><MapPin size={13} aria-hidden /> {item.location} · {formatDate(item.published_at || item.date)}</p>
        <p className="rg-post3-summary">{stripCitations(item.body)}</p>
        {steps.length ? <ul className="rg-post3-steps">{steps.map((step, i) => <li key={i}>{step}</li>)}</ul> : null}
        <footer>
          <Link to={`/advisories/${item.slug}`}>Buong payo <ArrowRight size={14} /></Link>
          <button type="button" onClick={() => toggle(item.id)} aria-pressed={saved} aria-label={saved ? "Alisin sa saved" : "I-save"}>
            <PhBookmark size={18} weight={saved ? "fill" : "regular"} /></button>
          <button type="button" onClick={() => void share()} aria-label="I-share"><PhShare size={18} /></button>
        </footer>
      </div>
    </article>
  );
}

/** Text with [S#] markers turned into links to the numbered sources below. */
function Cited({ text, sources }: { text: string; sources: WebSource[] }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(/\s*\[S(\d+)\]/g)) {
    parts.push(text.slice(last, match.index));
    const n = Number(match[1]);
    parts.push(sources.some((s) => s.n === n)
      ? <a key={match.index} className="rg-cite" href={`#source-${n}`}>{n}</a> : null);
    last = (match.index || 0) + match[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts.map((part, i) => <Fragment key={i}>{part}</Fragment>)}</>;
}

export function AdvisoryDetail({ item }: { item: Bulletin }) {
  const photos = photosOf(item);
  const [active, setActive] = useState(0);
  const shown = photos[Math.min(active, photos.length - 1)];
  const sources = (item.advisory_sources || []).filter((s): s is WebSource => "n" in s && "url" in s);
  const legacySources = (item.advisory_sources || []).filter((s) => !("n" in s)) as Array<{ disease: string; title: string; version: string; reference: string }>;
  const steps = advisoryActionSteps(item.action);
  const sev = item.severity_detail;
  return (
    <article className="rg-advisory3">
      <Link to="/bulletin" className="rg-back-link">← Field Bulletin</Link>
      <div className="rg-advisory3-grid">
        <section className="rg-advisory3-media" aria-label="Mga larawan">
          {shown ? <PhotoView photo={shown} /> : null}
          {photos.length > 1 ? (
            <div className="rg-advisory3-thumbs">
              {photos.map((photo, i) => (
                <button key={photo.url} type="button" aria-label={`Larawan ${i + 1}`} aria-current={i === active ? "true" : undefined} onClick={() => setActive(i)}>
                  {photo.type === "video" ? <span>Video</span> : <img src={photo.url} alt="" loading="lazy" />}
                </button>
              ))}
            </div>
          ) : null}
          {sev ? (
            <div className="rg-severity3">
              <h2>Gaano kalala?</h2>
              {Object.entries(sev.diseases).map(([disease, s]) => (
                <div key={disease} className={`rg-severity3-row is-${s!.category}`}>
                  <span><i style={{ background: DISEASE_COLORS[disease as Disease] }} />{DISEASE_NAMES[disease as Disease]}</span>
                  <b>{LEVEL[s!.category]}</b>
                  <meter min={0} max={50} value={Math.min(50, s!.percent)} aria-label={`${s!.percent}%`} />
                  <small>{s!.percent}% ng dahon ang may sakit sa larawan {s!.photo_number} (SES {s!.ses_score}) · {s!.affected_photos} sa {s!.usable_photos} larawan ang may tama</small>
                </div>
              ))}
              <details>
                <summary>Paano kinompute?</summary>
                <p>Bilang ng pixel na may sakit ÷ bilang ng pixel ng dahon ng palay × 100, sa larawang pinaka-apektado. Ang tubig at lupa ay hindi kasama. Ang resulta ay ginradong ayon sa IRRI Standard Evaluation System (SES) para sa palay.</p>
              </details>
            </div>
          ) : null}
        </section>
        <section className="rg-advisory3-text">
          <div className="rg-post3-meta">
            <DiseaseChips item={item} />
            <VerificationBadge status={item.verification_status} verifiedAt={item.verified_at} />
          </div>
          <h1>{stripCitations(item.title)}</h1>
          <p className="rg-post3-place"><MapPin size={14} aria-hidden /> {item.location} · {formatDate(item.published_at || item.date)}</p>
          {item.correction_note ? <p className="rg-correction">{item.correction_note}</p> : null}
          <p className="rg-advisory3-summary"><Cited text={item.body} sources={sources} /></p>
          <h2>Ano ang gagawin</h2>
          <ol className="rg-advisory3-steps">{steps.map((step, i) => <li key={i}><Cited text={step} sources={sources} /></li>)}</ol>
          {sev && item.limitations ? <><h2>Bantayan</h2><p><Cited text={item.limitations.replace(/^Bantayan:\s*/, "")} sources={sources} /></p></> : null}
          {sources.length ? (
            <div className="rg-advisory3-sources">
              <h2>Pinagkunan</h2>
              <ol>{sources.map((s) => <li key={s.n} id={`source-${s.n}`} value={s.n}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> <small>{s.publisher}</small></li>)}</ol>
            </div>
          ) : legacySources.length ? (
            <div className="rg-advisory3-sources">
              <h2>Pinagkunan</h2>
              <ul>{legacySources.map((s) => <li key={`${s.disease}:${s.version}`}><a href={s.reference} target="_blank" rel="noopener noreferrer">{s.title}</a> <small>{s.disease}</small></li>)}</ul>
            </div>
          ) : null}
        </section>
      </div>
    </article>
  );
}
