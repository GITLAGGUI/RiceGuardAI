import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase, supabaseConfigured } from "@/lib/supabase";

export const REGISTRATION_KEY = "riceguard-sms-registered-v1";
export const REGISTRATION_EVENT = "riceguard:registration-changed";

export function markSmsRegistered() {
  try { localStorage.setItem(REGISTRATION_KEY, "true"); } catch { /* no-op */ }
  window.dispatchEvent(new CustomEvent(REGISTRATION_EVENT));
}

export function useSmsRegistrationStatus() {
  const { user } = useAuth();
  const [registered, setRegistered] = useState(() => {
    try { return localStorage.getItem(REGISTRATION_KEY) === "true"; } catch { return false; }
  });

  useEffect(() => {
    const refreshLocal = () => {
      try { setRegistered(localStorage.getItem(REGISTRATION_KEY) === "true"); } catch { /* no-op */ }
    };
    window.addEventListener(REGISTRATION_EVENT, refreshLocal);
    window.addEventListener("storage", refreshLocal);
    return () => {
      window.removeEventListener(REGISTRATION_EVENT, refreshLocal);
      window.removeEventListener("storage", refreshLocal);
    };
  }, []);

  useEffect(() => {
    if (!user || registered || !supabaseConfigured) return;
    let active = true;
    void supabase.functions.invoke("field-operations", {
      body: { action: "registration-status", payload: {} },
    }).then(({ data }) => {
      if (!active || !data?.registered) return;
      markSmsRegistered();
      setRegistered(true);
    });
    return () => { active = false; };
  }, [registered, user]);

  return registered;
}
