export const SYSTEM_TEST_MESSAGE = "RiceGuardAI system test. This is a test message only, not a farm advisory. No action is required.";
export function validateSystemTest(ids: unknown, allowedIds: string[], expiresAt: string | undefined, now=Date.now()): string[] {
  const expires=Date.parse(expiresAt || "");
  if (!Number.isFinite(expires) || expires<=now) throw new Error("The temporary SMS test window is closed.");
  if (!Array.isArray(ids) || !ids.length || ids.length>2 || new Set(ids).size!==ids.length ||
      ids.some(id=>typeof id!=="string" || !allowedIds.includes(id)))
    throw new Error("Select only the explicitly authorized test contacts, up to two.");
  return ids;
}
