import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Languages, ArrowRight } from "lucide-react";
import { useLang } from "@/context/LangContext";

export function LanguagePicker() {
  const { chosen, choose, lang, setLang } = useLang();
  const [mounted, setMounted] = useState(false);

  // Delay mount slightly so it doesn't flash on hot reload / fast nav
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 250);
    return () => clearTimeout(t);
  }, []);

  const show = mounted && !chosen;

  return (
    <>
      {/* Modal on first visit */}
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-[100] bg-stone-950/70 backdrop-blur-md grid place-items-center px-5"
          >
            <motion.div
              initial={{ scale: 0.94, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 20 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-7 md:p-9"
            >
              <div className="w-14 h-14 rounded-2xl bg-rice-100 grid place-items-center text-forest-800 mb-5">
                <Languages size={26} />
              </div>
              <h2 className="font-display text-2xl md:text-3xl font-bold text-stone-900 leading-tight">
                Anong wika ang gusto mo?
              </h2>
              <p className="text-stone-500 mt-2 text-sm">
                Which language would you prefer to use?
              </p>

              <div className="mt-7 grid gap-3">
                <button
                  type="button"
                  onClick={() => choose("tl")}
                  className="group w-full text-left flex items-center gap-4 p-4 rounded-2xl border-2 border-stone-200 hover:border-forest-700 transition-all duration-200 cursor-pointer"
                >
                  <span className="text-3xl">🇵🇭</span>
                  <span className="flex-1">
                    <span className="block font-semibold text-stone-900">Taglish</span>
                    <span className="block text-sm text-stone-500">
                      Tagalog at English — para sa magsasaka
                    </span>
                  </span>
                  <ArrowRight
                    size={18}
                    className="text-stone-300 group-hover:text-forest-700 group-hover:translate-x-1 transition-all duration-200"
                  />
                </button>

                <button
                  type="button"
                  onClick={() => choose("en")}
                  className="group w-full text-left flex items-center gap-4 p-4 rounded-2xl border-2 border-stone-200 hover:border-forest-700 transition-all duration-200 cursor-pointer"
                >
                  <span className="text-3xl">🇬🇧</span>
                  <span className="flex-1">
                    <span className="block font-semibold text-stone-900">English</span>
                    <span className="block text-sm text-stone-500">
                      Full English interface
                    </span>
                  </span>
                  <ArrowRight
                    size={18}
                    className="text-stone-300 group-hover:text-forest-700 group-hover:translate-x-1 transition-all duration-200"
                  />
                </button>
              </div>

              <p className="text-xs text-stone-400 mt-6 text-center">
                Pwede mong baguhin ito mamaya / You can change this later.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating mini-toggle (always visible on landing top-right area) */}
      {chosen && <FloatingToggle lang={lang} setLang={setLang} />}
    </>
  );
}

function FloatingToggle({ lang, setLang }: { lang: "tl" | "en"; setLang: (l: "tl" | "en") => void }) {
  return (
    <div className="fixed top-20 right-4 z-[60] flex items-center bg-stone-900/70 backdrop-blur-md border border-white/10 rounded-full p-1 text-xs md:top-3 md:right-3">
      <button
        type="button"
        onClick={() => setLang("tl")}
        className={`px-3 py-1.5 rounded-full transition-colors duration-200 cursor-pointer ${
          lang === "tl" ? "bg-rice-400 text-forest-950 font-semibold" : "text-stone-200 hover:text-white"
        }`}
        aria-pressed={lang === "tl"}
      >
        TL
      </button>
      <button
        type="button"
        onClick={() => setLang("en")}
        className={`px-3 py-1.5 rounded-full transition-colors duration-200 cursor-pointer ${
          lang === "en" ? "bg-rice-400 text-forest-950 font-semibold" : "text-stone-200 hover:text-white"
        }`}
        aria-pressed={lang === "en"}
      >
        EN
      </button>
    </div>
  );
}
