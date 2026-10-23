import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
import { fieldOperation } from "./fieldOperations";
import { sampleData } from "./data";
import { processingSignature } from "./processingStatus";
import {
  type OperationsData,
  type Survey,
  type Contact,
} from "./domain";

const empty: OperationsData = {
  surveys: [],
  bulletins: [],
  contacts: [],
  campaigns: [],
  assets: [],
  jobs: [],
  providers: {
    drive: "configuration_required",
    kaggle: "configuration_required",
    sms: "configuration_required",
    advisory: "configuration_required",
  },
  models: [],
};
const key = "riceguard-operations-demo-v1";
export interface Store {
  operation: typeof operation;
  data: OperationsData;
  demo: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addSurvey: (s: Survey) => Promise<void>;
  review: (id: string) => Promise<void>;
  saveDraft: (id: string, body: string, action: string, title?: string, expectedRevision?: number) => Promise<void>;
  generateAdvisory: (id: string, mode?: "generate" | "refine") => Promise<string>;
  publish: (id: string) => Promise<{ public_path?: string; map_eligible?: boolean } | void>;
  addContact: (c: Contact) => Promise<void>;
  reset: () => void;
}
export const OperationsContext = createContext<Store | null>(null);
export async function operation(action: string, payload: unknown = {}) {
  return fieldOperation(action, payload);
}
export function OperationsProvider({
  demo,
  children,
}: {
  demo: boolean;
  children: ReactNode;
}) {
  const [data, setData] = useState<OperationsData>(() => {
    if (!demo) return empty;
    try {
      return (
        JSON.parse(localStorage.getItem(key) || "null") ||
        structuredClone(sampleData)
      );
    } catch {
      return structuredClone(sampleData);
    }
  });
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState<string | null>(null);
  const initialLoad = useRef(true);
  const inFlight = useRef<Promise<void> | null>(null);
  const statusSignature = useRef("");
  const refresh = useCallback(async () => {
    if (demo) return;
    if (inFlight.current) return inFlight.current;
    if (initialLoad.current) setLoading(true);
    const request = (async () => {
      try {
        const result = await operation("snapshot");
        statusSignature.current = processingSignature(result);
        setData(result);
        setError(null);
        initialLoad.current = false;
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    inFlight.current = request;
    try { await request; } finally { inFlight.current = null; }
  }, [demo]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (demo) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let checking = false;
    let failures = 0;
    const checkStatus = async () => {
      if (disposed || checking || document.hidden || !navigator.onLine) return;
      checking = true;
      try {
        // This route never re-signs media, checks SMS devices, or starts jobs.
        const result = await operation("processing-status");
        if (failures >= 3 && !disposed) setError(null);
        failures = 0;
        if (!disposed && processingSignature(result) !== statusSignature.current) await refresh();
      } catch {
        failures += 1;
        if (!disposed && failures >= 3) setError("Automatic status updates are unavailable. Check your connection or sign in again; your last good data is still displayed.");
      } finally { checking = false; }
    };
    const poll = async () => {
      await checkStatus();
      if (!disposed) timer = setTimeout(() => void poll(), 5_000);
    };
    const wake = () => { void checkStatus(); };
    timer = setTimeout(() => void poll(), 5_000);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [demo, refresh]);
  // Realtime: automation steps, surveys and jobs push changes the moment they happen.
  useEffect(() => {
    if (demo) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 600); };
    const channel = supabase.channel("rg-operations-live");
    for (const table of ["rg_pipeline_steps", "rg_surveys", "rg_processing_jobs"])
      channel.on("postgres_changes", { event: "*", schema: "public", table }, soon);
    channel.subscribe();
    return () => { clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [demo, refresh]);
  useEffect(() => {
    if (demo) localStorage.setItem(key, JSON.stringify(data));
  }, [data, demo]);
  const live = async (action: string, payload: unknown) => {
    const response = await operation(action, payload);
    await refresh();
    return response;
  };
  return (
    <OperationsContext.Provider
      value={{
        data,
        operation,
        demo,
        loading,
        error,
        refresh,
        addSurvey: async (s) => {
          if (demo) setData((d) => ({ ...d, surveys: [s, ...d.surveys] }));
          else await live("create-survey", s);
        },
        review: async (id) => {
          if (demo)
            setData((d) => ({
              ...d,
              surveys: d.surveys.map((s) =>
                s.id === id ? { ...s, status: "Reviewed" } : s,
              ),
            }));
          else await live("review-survey", { id });
        },
        saveDraft: async (id, body, action, title, expectedRevision) => {
          if (demo)
            setData((d) => ({
              ...d,
              bulletins: d.bulletins.map((b) =>
                b.id === id
                  ? { ...b, body, action, ...(title ? { title } : {}), status: "draft", reviewer: null }
                  : b,
              ),
            }));
          else await live("save-draft", { id, body, action, title, advisory_revision: expectedRevision ?? data.bulletins.find(b => b.id === id)?.advisory_revision });
        },
        generateAdvisory: async (id, mode = "generate") => {
          if (demo) throw new Error("Advisory generation is not available in fixtures.");
          const { data: generated, error: generationError } = await supabase.functions.invoke("generate-advisory", { body: { bulletin_id: id, mode } });
          if (generationError || generated?.error) throw new Error(generated?.error || generationError?.message || "Advisory generation failed");
          await refresh();
          return generated.generation_mode;
        },
        publish: async (id) => {
          if (!demo) {
            const bulletin = data.bulletins.find((item) => item.id === id);
            if (!bulletin) throw new Error("Advisory not found");
            const preview = await operation("recipient-preview", { id });
            const published = await live("publish", {
              id,
              advisory_revision: bulletin.advisory_revision || bulletin.revision || 1,
              recipient_preview_hash: preview.hash,
              send_sms: false,
            });
            return published;
          }
          setData((d) => {
            const b = d.bulletins.find((x) => x.id === id);
            if (!b || b.status === "published") return d;
            return {
              ...d,
              bulletins: d.bulletins.map((b) =>
                b.id === id
                  ? { ...b, status: "published", reviewer: "Demo operator" }
                  : b,
              ),
            };
          });
        },
        addContact: async (c) => {
          if (demo) {
            if (data.contacts.some((x) => x.phone === c.phone))
              throw new Error("This number is already registered.");
            if (data.contacts.length >= 100)
              throw new Error("Pilot limit: 100 contacts.");
            setData((d) => ({ ...d, contacts: [...d.contacts, c] }));
          } else await live("create-contact", c);
        },
        reset: () => {
          if (demo) setData(structuredClone(sampleData));
        },
      }}
    >
      {children}
    </OperationsContext.Provider>
  );
}
export function useOperations() {
  const ctx = useContext(OperationsContext);
  if (!ctx) throw new Error("Operations provider missing");
  return ctx;
}
