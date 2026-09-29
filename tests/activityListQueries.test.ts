import test from "node:test";
import assert from "node:assert/strict";
import { listPatientAppointmentsQuerySchema } from "../src/schemas/appointmentSchema";
import { listRoundsQuerySchema } from "../src/schemas/roundSchema";

test("appointment list accepts an exact date without changing the existing from query", () => {
  assert.equal(listPatientAppointmentsQuerySchema.parse({ date: "2026-09-28" }).date, "2026-09-28");
  assert.equal(listPatientAppointmentsQuerySchema.parse({ from: "2026-09-28" }).from, "2026-09-28");
  assert.equal(
    listPatientAppointmentsQuerySchema.safeParse({ date: "2026-09-28", from: "2026-09-27" }).success,
    false,
  );
});

test("patient appointment range is bounded to one month", () => {
  const query = listPatientAppointmentsQuerySchema.parse({ from: "2026-09-01", to: "2026-09-30" });
  assert.equal(query.to, "2026-09-30");
  assert.equal(listPatientAppointmentsQuerySchema.safeParse({ to: "2026-09-30" }).success, false);
  assert.equal(listPatientAppointmentsQuerySchema.safeParse({ from: "2026-09-30", to: "2026-09-01" }).success, false);
  assert.equal(listPatientAppointmentsQuerySchema.safeParse({ from: "2026-09-01", to: "2026-10-02" }).success, false);
});

test("round list accepts an ISO actionable instant and progress flag", () => {
  const query = listRoundsQuerySchema.parse({
    status: "pending",
    actionable_at: "2026-09-28T01:00:00.000Z",
    include_progress: "true",
  });
  assert.equal(query.actionable_at, "2026-09-28T01:00:00.000Z");
  assert.equal(listRoundsQuerySchema.safeParse({ actionable_at: "midnight" }).success, false);
});
