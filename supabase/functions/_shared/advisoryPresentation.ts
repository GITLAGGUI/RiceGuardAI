const CURRENT_DISEASES = ["BLB", "Brown Spot"] as const;

export function reviewedDiseaseLabel(value: { disease?: unknown; diseases?: unknown }): string {
  const selected = Array.isArray(value.diseases) && value.diseases.length > 0
    ? value.diseases
    : [value.disease];
  const valid = CURRENT_DISEASES.filter((disease) => selected.includes(disease));
  return valid.length ? valid.join(" and ") : "rice disease";
}

export function smsAdvisoryMessage(
  bulletin: { disease?: unknown; diseases?: unknown; action: string; slug: string; lat?: number | null; lng?: number | null; public_location_approved?: boolean; approximate_location?: boolean },
  publicUrl: string,
  inboundOptOutEnabled: boolean,
): string {
  const stopText = inboundOptOutEnabled
    ? "Reply STOP to opt out."
    : "Manage alerts on the RiceGuardAI website.";
  const map = publicCoordinateLink(bulletin);
  const prefix = `RiceGuardAI\n${reviewedDiseaseLabel(bulletin)} advisory\n`;
  const suffix = `\n${map ? `Map (approximate): ${map}\n` : ""}Details: ${publicUrl}\n${stopText}`;
  const actionBudget = Math.max(0, 620 - prefix.length - suffix.length);
  const steps = advisoryActionSteps(bulletin.action).map(step => `- ${step}`).join("\n");
  const action = steps.length <= actionBudget ? steps : `${steps.slice(0, Math.max(0, actionBudget - 3)).trimEnd()}...`;
  return `${prefix}${action}${suffix}`;
}

export function publicCoordinateLink(point: { lat?: number | null; lng?: number | null; public_location_approved?: boolean; approximate_location?: boolean }): string | null {
  if (!(point.public_location_approved === true || point.approximate_location === true) ||
    typeof point.lat !== "number" || typeof point.lng !== "number" || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) ||
    Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180 || (point.lat === 0 && point.lng === 0)) return null;
  return `https://www.google.com/maps?q=${point.lat.toFixed(2)},${point.lng.toFixed(2)}`;
}

export function advisoryActionSteps(action: string): string[] {
  const text = action.trim();
  if (!text) return [];
  const numbered = [...text.matchAll(/(?:^|\s)(\d+)[.)]\s+/g)];
  if (numbered.length > 1) return numbered.map((match, index) => text.slice((match.index || 0) + match[0].length, numbered[index + 1]?.index ?? text.length).trim()).filter(Boolean);
  return text.split(/\n+/).map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()).filter(Boolean);
}
