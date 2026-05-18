import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "tl" | "en";

const STORAGE_KEY = "rg_lang";

interface LangContextValue {
  lang: Lang;
  setLang: (next: Lang) => void;
  /** Has the user explicitly chosen a language yet? */
  chosen: boolean;
  choose: (next: Lang) => void;
}

const LangContext = createContext<LangContextValue | undefined>(undefined);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("tl");
  const [chosen, setChosen] = useState<boolean>(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (stored === "tl" || stored === "en") {
      setLangState(stored);
      setChosen(true);
    }
  }, []);

  const setLang = (next: Lang) => {
    setLangState(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  const choose = (next: Lang) => {
    setLang(next);
    setChosen(true);
  };

  return (
    <LangContext.Provider value={{ lang, setLang, chosen, choose }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within LangProvider");
  return ctx;
}

/**
 * Lightweight inline translator. Pass a dictionary like:
 *   const t = useT({ tl: { x: 'kuwento' }, en: { x: 'story' } });
 *   t('x');
 */
export function useT<D extends Record<Lang, Record<string, string>>>(dict: D) {
  const { lang } = useLang();
  return (key: keyof D["tl"]): string => {
    const map = dict[lang] ?? dict.tl;
    return (map as Record<string, string>)[key as string] ?? (key as string);
  };
}
