type StatusRow = { id: string; status: string; progress?: number; active_result_revision?: number | null; approved_result_revision?: number | null; stage_updated_at?: string; updated_at?: string; advisory_revision?: number };
/** Ignore signed URLs and unrelated form data when deciding whether to reload. */
export function processingSignature(data: { surveys: StatusRow[]; jobs: StatusRow[]; bulletins?: StatusRow[] }) {
  return JSON.stringify([data.surveys, data.jobs, data.bulletins || []].map((rows,group) => rows.map(row => [
    row.id, row.status, row.progress ?? 0, row.active_result_revision ?? null,
    row.approved_result_revision ?? null, row.advisory_revision ?? null,
    group === 0 ? row.stage_updated_at ?? null : group === 2 ? row.updated_at ?? null : null,
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))));
}
