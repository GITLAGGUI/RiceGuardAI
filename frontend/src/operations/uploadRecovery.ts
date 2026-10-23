import type { Asset, Survey } from "./domain";

export function findResumableSurvey(
  surveys: Survey[],
  assets: Asset[],
  selectedChecksums: string[],
): Survey | null {
  if (!selectedChecksums.length) return null;
  const selected = new Set(selectedChecksums);
  return surveys.find((survey) => {
    if (survey.status !== "Awaiting upload" || survey.expected_assets !== selectedChecksums.length)
      return false;
    const existing = assets.filter((asset) => asset.survey_id === survey.id);
    if (!existing.length || existing.length > selectedChecksums.length) return false;
    const checksums = existing.map((asset) => asset.checksum).filter((value): value is string => Boolean(value));
    return checksums.length === existing.length && new Set(checksums).size === checksums.length &&
      checksums.every((checksum) => selected.has(checksum));
  }) || null;
}

export function findInterruptedSurveyMatch(
  surveys: Survey[],
  assets: Asset[],
  selectedChecksums: string[],
): Survey | null {
  if (!selectedChecksums.length) return null;
  const selected = new Set(selectedChecksums);
  return surveys.find((survey) => survey.status === "Awaiting upload" &&
    assets.some((asset) => asset.survey_id === survey.id && asset.checksum && selected.has(asset.checksum))) || null;
}

