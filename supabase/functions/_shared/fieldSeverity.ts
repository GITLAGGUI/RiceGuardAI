export function validateFieldSeverity(value: unknown) {
  const p = value as Record<string, unknown> | null;
  if (!p || !["BLB", "Brown Spot"].includes(String(p.disease))) throw new Error("Select the disease assessed in the field");
  if (!["low", "moderate", "high"].includes(String(p.category))) throw new Error("Select a field severity category");
  // Legacy measured callers omitted basis; keep that explicit measurement path.
  // An unknown supplied basis must never silently become a measured assessment.
  if (p.basis !== undefined && !["manual_field_assessment", "reviewed_visual_estimate"].includes(String(p.basis)))
    throw new Error("Select a measured assessment or reviewed visual estimate basis");
  if (p.basis === "reviewed_visual_estimate") {
    if (p.confirmed !== true) throw new Error("Confirm that you reviewed the visible leaf damage");
    if (typeof p.specialist !== "string" || p.specialist.trim().length < 2 || p.specialist.length > 120)
      throw new Error("Record the approving reviewer name");
    if (typeof p.notes !== "string" || p.notes.trim().length < 20 || p.notes.length > 2000)
      throw new Error("Explain the visible evidence and any change to the AI suggestion");
    if (!Number.isInteger(p.advisory_revision) || Number(p.advisory_revision) < 1)
      throw new Error("Reload the current advisory revision");
    return { disease: String(p.disease), category: String(p.category), specialist: p.specialist.trim(), notes: p.notes.trim(),
      basis: "reviewed_visual_estimate", model_calibrated: false, scope: "reviewed_media_not_whole_field",
      confirmed: true, advisory_revision: Number(p.advisory_revision) };
  }
  if (typeof p.leaf_area_affected_pct !== "number" || !Number.isFinite(p.leaf_area_affected_pct) || p.leaf_area_affected_pct < 0 || p.leaf_area_affected_pct > 100)
    throw new Error("Enter a measured affected leaf area between 0 and 100 percent");
  if (typeof p.sampled_leaves !== "number" || !Number.isInteger(p.sampled_leaves) || p.sampled_leaves < 1 || p.sampled_leaves > 10000)
    throw new Error("Enter the number of independently sampled leaves");
  if (typeof p.specialist !== "string" || p.specialist.trim().length < 2 || p.specialist.length > 120)
    throw new Error("Record the field assessor name");
  if (typeof p.notes !== "string" || p.notes.trim().length < 20 || p.notes.length > 2000)
    throw new Error("Describe sampling, the scoring method and category rationale");
  return { disease: String(p.disease), category: String(p.category),
    leaf_area_affected_pct: p.leaf_area_affected_pct, sampled_leaves: p.sampled_leaves,
    specialist: p.specialist.trim(), notes: p.notes.trim(),
    basis: "manual_field_assessment", model_calibrated: false, scope: "sampled_leaves_not_whole_field" };
}
