import "./operations.css";
import "./bulletin.css";
import { useEffect, useId, useRef, useState } from "react";
import { BadgeCheck, HelpCircle, PencilLine } from "lucide-react";

type Status = "unverified" | "verified" | "corrected" | "retracted" | undefined | null;

const copy: Record<"unverified" | "verified" | "corrected", { label: string; title: string; body: string }> = {
  unverified: {
    label: "Hindi pa verified",
    title: "Fully automated ang prediction na ito",
    body: "Galing ito sa AI at hindi pa nave-verify ng aming specialist. Puwede pa itong magbago pagkatapos nilang suriin ang mga larawan.",
  },
  verified: {
    label: "Verified",
    title: "Na-verify na ng specialist",
    body: "Tiningnan ng aming specialist ang bawat nakitang sakit sa mga larawan at kinumpirma ang resulta.",
  },
  corrected: {
    label: "Inayos ng specialist",
    title: "Inayos ng specialist",
    body: "Sinuri ng specialist ang resulta ng AI at itinama ang ilang nakitang sakit. Na-update na rin ang severity at payo.",
  },
};

/** "?" for automated posts, a check once a specialist has looked. Tap or click opens the explanation. */
export function VerificationBadge({ status, verifiedAt, size = "md" }: { status: Status; verifiedAt?: string | null; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  if (!status || status === "retracted") return null;
  const text = copy[status];
  const Icon = status === "unverified" ? HelpCircle : status === "corrected" ? PencilLine : BadgeCheck;
  return (
    <span ref={root} className={`rg-verify-badge is-${status} is-${size}`}>
      <button type="button" aria-label={text.label} aria-expanded={open} aria-controls={id}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen((value) => !value); }}>
        <Icon size={size === "sm" ? 15 : 17} strokeWidth={2.2} aria-hidden />
        {status !== "unverified" ? <span>{text.label}</span> : null}
      </button>
      {open ? (
        <span role="dialog" id={id} className="rg-verify-popover">
          <strong>{text.title}</strong>
          <span>{text.body}</span>
          {verifiedAt && status !== "unverified"
            ? <small>{new Date(verifiedAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</small>
            : null}
        </span>
      ) : null}
    </span>
  );
}
