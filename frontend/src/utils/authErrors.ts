/**
 * Translate raw Supabase Auth errors into Tagalog-friendly toast messages.
 *
 * Important behavior: if the phone we sent was already a valid +639XXXXXXXXX,
 * then we KNOW the failure is server-side (provider/hook not configured,
 * rate-limit, network), NOT a phone format issue. We surface the config
 * problem clearly so the user doesn't waste time re-typing a number that
 * was correct the whole time.
 */

const PROVIDER_KEYWORDS = [
  "unsupported phone provider",
  "phone provider",
  "sms provider",
  "sms_provider",
  "provider is not enabled",
  "provider not enabled",
  "provider_disabled",
  "phone_provider_disabled",
  "no sms provider",
  "sms not enabled",
  "error sending sms",
  "error sending confirmation sms",
  "failed to send sms",
  "sms_send_failed",
  "sms hook",
  "send_sms_hook",
];

const RATE_LIMIT_KEYWORDS = [
  "rate limit",
  "rate_limit",
  "too many",
  "for security purposes",
  "wait",
];

const NETWORK_KEYWORDS = ["failed to fetch", "network", "timeout", "load failed"];

function matchesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/**
 * @param message - The raw error.message string from Supabase
 * @param phone   - The display-formatted phone (e.g. "+63 915 368 3496") for echoing back
 */
export function authOtpErrorMessage(message: string, phone?: string): string {
  const lower = (message || "").toLowerCase();
  const target = phone ? ` Target number: ${phone}.` : "";

  // 1. Provider / hook not configured — by far the most common cause when nothing
  //    on the Supabase side has been wired up yet.
  if (matchesAny(lower, PROVIDER_KEYWORDS)) {
    return (
      "Hindi number format ang problema. Naka-+63 na ito." +
      target +
      " Kailangan pang i-enable ang Supabase Send SMS Auth Hook / Phone provider para makapagpadala ng OTP. (Auth → Providers → Phone, at Auth → Hooks → Send SMS hook)"
    );
  }

  // 2. Rate limiting
  if (matchesAny(lower, RATE_LIMIT_KEYWORDS)) {
    return "Masyadong sunod-sunod ang request. Maghintay 30-60 segundo bago humingi ulit ng code.";
  }

  // 3. Network / fetch failures
  if (matchesAny(lower, NETWORK_KEYWORDS)) {
    return "Walang sagot ang server. Subukan ang koneksyon at ulitin.";
  }

  // 4. Phone-related — but if we already validated the format client-side and
  //    got +639XXXXXXXXX, then "phone" in the server response really means
  //    "we couldn't deliver SMS", not "format wrong". Treat as provider issue.
  if (lower.includes("phone") || lower.includes("number")) {
    return (
      "Tama ang format ng number." +
      target +
      " Pero hindi ito matanggap ng SMS provider sa Supabase. Check Auth → Providers → Phone at Auth → Hooks → Send SMS hook."
    );
  }

  // 5. Unknown — surface the raw message so we have something to debug, but
  //    keep it short and add a hint.
  return `Hindi naipadala ang code (${message || "unknown error"}). Check Supabase Auth SMS config.`;
}
