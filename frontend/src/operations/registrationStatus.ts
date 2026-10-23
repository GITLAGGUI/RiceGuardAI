import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { subscriberSupabase, supabaseConfigured } from "@/lib/supabase";
import { FieldOperationError, fieldOperation } from "./fieldOperations";

export const REGISTRATION_KEY = "riceguard-sms-registration-cache-v2";
export const REGISTRATION_EVENT = "riceguard:registration-changed";

export type SmsRegistrationStatus = {
  registered: boolean;
  consent: boolean;
  alertReady: boolean;
  barangayCode?: string;
  name?: string;
};

const emptyStatus: SmsRegistrationStatus = {
  registered: false,
  consent: false,
  alertReady: false,
};

function writeDisplayCache(status: SmsRegistrationStatus) {
  try {
    localStorage.setItem(REGISTRATION_KEY, JSON.stringify(status));
  } catch {
    // Registration remains server-authoritative when storage is unavailable.
  }
}

export function announceSmsRegistrationChange() {
  window.dispatchEvent(new CustomEvent(REGISTRATION_EVENT));
}

export function useSubscriberSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(supabaseConfigured);

  useEffect(() => {
    if (!supabaseConfigured) {
      return;
    }
    let active = true;
    void subscriberSupabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = subscriberSupabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setLoading(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}

export function useSmsRegistration() {
  const { session, loading: sessionLoading } = useSubscriberSession();
  const [status, setStatus] = useState<SmsRegistrationStatus>(emptyStatus);
  const [loading, setLoading] = useState(sessionLoading);

  const refresh = useCallback(async () => {
    if (!supabaseConfigured || !session) {
      setStatus(emptyStatus);
      setLoading(false);
      return emptyStatus;
    }
    setLoading(true);
    try {
      const data = await fieldOperation("registration-status", {}, subscriberSupabase);
      const next: SmsRegistrationStatus = {
        registered: Boolean(data?.registered),
        consent: Boolean(data?.consent),
        alertReady: Boolean(data?.alert_ready),
        barangayCode: data?.barangay_code || undefined,
        name: data?.name || undefined,
      };
      setStatus(next);
      writeDisplayCache(next);
      return next;
    } catch (error) {
      setStatus(emptyStatus);
      if (error instanceof FieldOperationError && error.code === "AUTH_REQUIRED") {
        await subscriberSupabase.auth.signOut();
      }
      return emptyStatus;
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (sessionLoading) return;
    void refresh();
  }, [refresh, sessionLoading]);

  useEffect(() => {
    const handleChange = () => { void refresh(); };
    window.addEventListener(REGISTRATION_EVENT, handleChange);
    return () => window.removeEventListener(REGISTRATION_EVENT, handleChange);
  }, [refresh]);

  return {
    ...status,
    authenticated: Boolean(session),
    loading: sessionLoading || loading,
    session,
    refresh,
  };
}

export function useSmsRegistrationStatus() {
  return useSmsRegistration().registered;
}
