import { test } from "node:test";
import assert from "node:assert/strict";
import { daysUntilAppointment, shouldNotifyAt } from "../src/services/schedulerService";
import { collapseDuplicateRounds } from "../src/services/roundService";
import { collapseDuplicateMedicationLogs } from "../src/services/medicationLogService";
import type { MedicationLogRow, RoundInstanceRow } from "../src/types/database";

function round(over: Partial<RoundInstanceRow>): RoundInstanceRow {
  return {
    id: "r1", patient_id: "p1", template_code: "WEEKLY_CHECKIN",
    prescription_id: null, target_dose_at: null, medication_log_id: null, appointment_id: null,
    scheduled_at: "2026-09-27T23:30:00.000Z", activity_date: "2026-09-28",
    available_at: "2026-09-27T23:30:00.000Z", due_at: "2026-09-27T23:30:00.000Z",
    idempotency_key: null, expires_at: "2026-09-28T16:59:59.999Z", completed_at: null,
    status: "pending", answered_by: null, submitted_at: null, received_at: null,
    created_at: "2026-09-27T23:30:00.000Z", ...over,
  };
}

function med(over: Partial<MedicationLogRow>): MedicationLogRow {
  return {
    id: "m1", patient_id: "p1", prescription_id: "rx1",
    planned_at: "2026-09-28T01:00:00.000Z", activity_date: "2026-09-28",
    idempotency_key: null, taken_at: null, dose_taken: null, late_minutes: null,
    status: "pending", note: null, submitted_at: null, received_at: "2026-09-28T01:00:00.000Z",
    ...over,
  };
}

test("late scheduler catch-up creates activity without a wrong-time push", () => {
  const due = new Date("2026-09-28T01:00:00.000Z");
  assert.equal(shouldNotifyAt(due, new Date("2026-09-28T00:59:59.000Z")), false);
  assert.equal(shouldNotifyAt(due, new Date("2026-09-28T01:01:59.000Z")), true);
  assert.equal(shouldNotifyAt(due, new Date("2026-09-28T08:00:00.000Z")), false);
});

test("appointment reminders use Bangkok calendar dates", () => {
  const lateSundayUtc = new Date("2026-09-27T18:00:00.000Z"); // จันทร์ 01:00 เวลาไทย
  assert.equal(daysUntilAppointment("2026-09-29", lateSundayUtc), 1);
  assert.equal(daysUntilAppointment("2026-09-30", lateSundayUtc), 2);
  assert.equal(daysUntilAppointment("2026-10-01", lateSundayUtc), 3);
});

test("historical duplicate weekly rounds are displayed once and completed wins", () => {
  const rows = [round({ id: "pending" }), round({ id: "done", status: "completed" })];
  assert.deepEqual(collapseDuplicateRounds(rows).map((item) => item.id), ["done"]);
});

test("different daily and weekly templates on the same date remain separate", () => {
  const rows = [round({ id: "daily", template_code: "MORNING_CHECKIN" }), round({ id: "weekly" })];
  assert.equal(collapseDuplicateRounds(rows).length, 2);
});

test("historical duplicate medication doses are displayed once and taken wins", () => {
  const rows = [med({ id: "pending" }), med({ id: "taken", status: "taken" })];
  assert.deepEqual(collapseDuplicateMedicationLogs(rows).map((item) => item.id), ["taken"]);
});
