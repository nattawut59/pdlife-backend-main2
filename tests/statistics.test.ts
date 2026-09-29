import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateDailyStatistics } from "../src/services/statisticsService";
import type { MedicationLogRow, OnOffTimelineRow } from "../src/types/database";

function timeline(ts: string, state: string, dyskinesia: string): OnOffTimelineRow {
  return { patient_id: "p1", ts, template_code: "POST_MED_MICRO", prescription_id: null, target_dose_at: null, state, dyskinesia, adherence: null };
}

function log(planned_at: string, status: MedicationLogRow["status"]): MedicationLogRow {
  return { id: planned_at, patient_id: "p1", prescription_id: "rx1", planned_at, activity_date: "2026-09-28", idempotency_key: null, taken_at: null, dose_taken: null, late_minutes: null, status, note: null, submitted_at: null, received_at: planned_at };
}

test("statistics groups events by Bangkok calendar day and excludes pending doses", () => {
  const result = aggregateDailyStatistics(
    7,
    "2026-09-28",
    [timeline("2026-09-27T18:00:00.000Z", "state_off", "no")],
    [log("2026-09-27T18:30:00.000Z", "taken"), log("2026-09-28T01:00:00.000Z", "pending")]
  );
  const september28 = result.daily.at(-1)!;
  assert.equal(september28.date, "2026-09-28");
  assert.equal(september28.off_rate, 1);
  assert.equal(september28.adherence_rate, 1);
  assert.equal(september28.doses_taken, 1);
  assert.equal(result.streak_days_logged, 1);
});

test("statistics keeps missing data null instead of presenting it as zero", () => {
  const result = aggregateDailyStatistics(7, "2026-09-28", [], []);
  assert.equal(result.adherence_rate, null);
  assert.equal(result.off_rate, null);
  assert.equal(result.daily[0].doses_taken, null);
  assert.equal(result.streak_days_logged, 0);
});
