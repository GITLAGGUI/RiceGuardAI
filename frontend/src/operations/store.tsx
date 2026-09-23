import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { sampleData } from "./data";
import {
  eligibleContacts,
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
interface Store {
  data: OperationsData;
  demo: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addSurvey: (s: Survey) => Promise<void>;
  review: (id: string) => Promise<void>;
  saveDraft: (id: string, body: string, action: string) => Promise<void>;
  generateAdvisory: (id: string) => Promise<string>;
  publish: (id: string) => Promise<void>;
  addContact: (c: Contact) => Promise<void>;
  reset: () => void;
}
const Context = createContext<Store | null>(null);
export async function operation(action: string, payload: unknown = {}) {
  if (!supabaseConfigured)
    throw new Error("Supabase is not configured. No live changes were made.");
  const { data, error } = await supabase.functions.invoke("field-operations", {
    body: { action, payload },
  });
  if (error || data?.error)
    throw new Error(data?.error || error?.message || "Operation failed");
  return data;
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
  const refresh = useCallback(async () => {
    if (demo) return;
    setLoading(true);
    try {
      const result = await operation("snapshot");
      setData(result);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [demo]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (demo) localStorage.setItem(key, JSON.stringify(data));
  }, [data, demo]);
  const live = async (action: string, payload: unknown) => {
    await operation(action, payload);
    await refresh();
  };
  return (
    <Context.Provider
      value={{
        data,
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
        saveDraft: async (id, body, action) => {
          if (demo)
            setData((d) => ({
              ...d,
              bulletins: d.bulletins.map((b) =>
                b.id === id
                  ? { ...b, body, action, status: "draft", reviewer: null }
                  : b,
              ),
            }));
          else await live("save-draft", { id, body, action });
        },
        generateAdvisory: async (id) => {
          if (demo) throw new Error("Advisory generation is not available in fixtures.");
          const { data: generated, error: generationError } = await supabase.functions.invoke("generate-advisory", { body: { bulletin_id: id } });
          if (generationError || generated?.error) throw new Error(generated?.error || generationError?.message || "Advisory generation failed");
          await refresh();
          return generated.generation_mode;
        },
        publish: async (id) => {
          if (!demo) {
            const bulletin = data.bulletins.find((item) => item.id === id);
            if (!bulletin) throw new Error("Advisory not found");
            const preview = await operation("recipient-preview", { id });
            await live("publish", {
              id,
              advisory_revision: bulletin.advisory_revision || bulletin.revision || 1,
              recipient_preview_hash: preview.hash,
            });
            return;
          }
          setData((d) => {
            const b = d.bulletins.find((x) => x.id === id);
            if (!b || d.campaigns.some((c) => c.bulletin_id === id)) return d;
            return {
              ...d,
              bulletins: d.bulletins.map((b) =>
                b.id === id
                  ? { ...b, status: "published", reviewer: "Demo operator" }
                  : b,
              ),
              campaigns: [
                ...d.campaigns,
                {
                  id: crypto.randomUUID(),
                  bulletin_id: id,
                  created_at: new Date().toISOString(),
                  recipients:
                    b.lat != null && b.lng != null
                      ? eligibleContacts(d.contacts, { lat: b.lat, lng: b.lng }).length
                      : 0,
                  status: "queued",
                  sample: true,
                },
              ],
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
    </Context.Provider>
  );
}
export function useOperations() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("Operations provider missing");
  return ctx;
}
