import { advisoryActionSteps } from "./advisoryPresentation";
export function shortAdvisoryText(text: string, limit: number) {
  if (text.length <= limit) return text;
  const part = text.slice(0, limit);
  const wordEnd = part.lastIndexOf(" ");
  return `${part.slice(0, wordEnd > limit * 0.6 ? wordEnd : limit).trimEnd()}…`;
}
export function advisoryPreview(summary: string, action: string) {
  const steps = advisoryActionSteps(action);
  return { summary: shortAdvisoryText(summary, 260), actions: steps.slice(0, 2).map(step => shortAdvisoryText(step, 220)),
    expandable: summary.length > 260 || steps.length > 2 || steps.some(step => step.length > 220) };
}
