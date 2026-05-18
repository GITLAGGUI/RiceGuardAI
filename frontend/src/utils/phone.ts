/**
 * Normalize a Philippine phone number to canonical E.164 (+639XXXXXXXXX).
 * Accepts inputs like:  09171234567 · 9171234567 · 639171234567 · +639171234567 · "917 123 4567"
 */
export function normalizePhPhone(input: string): string | null {
  const digits = input.replace(/\D+/g, "");
  if (!digits) return null;
  let n = digits;
  if (n.startsWith("63")) n = n.slice(2);
  if (n.startsWith("0")) n = n.slice(1);
  if (n.length !== 10 || !n.startsWith("9")) return null;
  return `+63${n}`;
}

export function formatPhDisplay(e164: string): string {
  if (!e164.startsWith("+63") || e164.length !== 13) return e164;
  const rest = e164.slice(3); // "9XXXXXXXXX"
  return `+63 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`;
}

/**
 * Sanitize and live-format raw input for the PH mobile field shown next to the
 * fixed "+63" prefix. Rules:
 *   - strips non-digits
 *   - strips leading "63" (pasted with country code) and leading "0" (pasted "09...")
 *   - first remaining digit MUST be 9; anything else is rejected (returns "")
 *   - caps at 10 digits
 *   - formats as "9XX XXX XXXX"
 */
export function formatPhInput(raw: string): string {
  let digits = raw.replace(/\D+/g, "");
  if (digits.startsWith("63")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 0) return "";
  if (digits[0] !== "9") return "";
  digits = digits.slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

/** Extract raw 10-digit local number from the formatted input string. */
export function phInputDigits(input: string): string {
  return input.replace(/\D+/g, "").slice(0, 10);
}
