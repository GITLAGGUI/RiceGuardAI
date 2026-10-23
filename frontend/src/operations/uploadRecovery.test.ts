import { describe, expect, it } from "vitest";
import type { Asset, Survey } from "./domain";
import { findInterruptedSurveyMatch, findResumableSurvey } from "./uploadRecovery";

const survey = {
  id: "survey-1",
  name: "Field test",
  location: "Isabela",
  captured_at: new Date().toISOString(),
  camera: "DJI",
  status: "Awaiting upload",
  photos: 8,
  expected_assets: 8,
  severity: "not_calibrated",
  lat: null,
  lng: null,
} satisfies Survey;

const asset = (checksum: string): Asset => ({
  id: crypto.randomUUID(),
  survey_id: survey.id,
  name: `${checksum}.jpg`,
  mime: "image/jpeg",
  bytes: 100,
  status: "Uploading",
  preview_url: null,
  drive_file_id: null,
  checksum,
  width: 1000,
  height: 1000,
  duration_seconds: null,
});

describe("findResumableSurvey", () => {
  it("matches an interrupted partial batch only when every existing checksum is reselected", () => {
    const checksums = Array.from({ length: 8 }, (_, index) => `hash-${index}`);
    expect(findResumableSurvey([survey], checksums.slice(0, 7).map(asset), checksums)?.id).toBe(survey.id);
    expect(findResumableSurvey([survey], checksums.slice(0, 7).map(asset), checksums.slice(1))).toBeNull();
  });

  it("does not attach arbitrary files to an empty or completed survey", () => {
    const checksums = Array.from({ length: 8 }, (_, index) => `hash-${index}`);
    expect(findResumableSurvey([survey], [], checksums)).toBeNull();
    expect(findResumableSurvey([{ ...survey, status: "Queued" }], [asset(checksums[0])], checksums)).toBeNull();
  });

  it("detects a partial interrupted batch so a duplicate survey can be blocked", () => {
    const checksums = Array.from({ length: 8 }, (_, index) => `hash-${index}`);
    const existing = checksums.slice(0, 7).map(asset);
    expect(findInterruptedSurveyMatch([survey], existing, checksums.slice(0, 7))?.id).toBe(survey.id);
    expect(findInterruptedSurveyMatch([survey], existing, ["unrelated"])).toBeNull();
  });
});

