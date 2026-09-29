import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAdherenceRate,
  computeDyskinesiaRate,
  computeOffRate,
  countFallsOrNearFalls,
  countFallsWithInjury,
  countOrthostaticSignals,
  longestOffStreakDays,
} from "../src/services/dashboardService";
import type { OnOffTimelineRow, ResponseRow } from "../src/types/database";

function timelinePoint(overrides: Partial<OnOffTimelineRow>): OnOffTimelineRow {
  return {
    patient_id: "p1",
    ts: "2026-07-20T08:00:00.000Z",
    template_code: "POST_MED_MICRO",
    prescription_id: null,
    target_dose_at: null,
    state: null,
    dyskinesia: null,
    adherence: null,
    ...overrides,
  };
}

function response(
  overrides: Partial<ResponseRow>
): Pick<ResponseRow, "answer_value" | "skipped"> {
  return {
    answer_value: { choice: undefined, score: undefined, ...overrides.answer_value },
    skipped: overrides.skipped ?? false,
  };
}

test("computeOffRate: only counts definitive on/off states, ignores too_soon/asleep", () => {
  const timeline = [
    timelinePoint({ state: "state_off" }),
    timelinePoint({ state: "state_on" }),
    timelinePoint({ state: "state_on" }),
    timelinePoint({ state: "too_soon" }),
    timelinePoint({ state: "asleep" }),
  ];
  assert.equal(computeOffRate(timeline), 1 / 3);
});

test("computeOffRate: null when no definitive states answered", () => {
  assert.equal(computeOffRate([timelinePoint({ state: "too_soon" })]), null);
  assert.equal(computeOffRate([]), null);
});

test("computeDyskinesiaRate: 'no' is the only non-present choice", () => {
  const timeline = [
    timelinePoint({ dyskinesia: "no" }),
    timelinePoint({ dyskinesia: "yes_nondisturb" }),
    timelinePoint({ dyskinesia: "yes_disturb" }),
    timelinePoint({ dyskinesia: null }), // unanswered -> excluded from denominator
  ];
  assert.equal(computeDyskinesiaRate(timeline), 2 / 3);
});

test("computeAdherenceRate: taken / total, null when nothing recorded", () => {
  assert.equal(computeAdherenceRate({ taken: 3, skipped: 1, total: 4 }), 0.75);
  assert.equal(computeAdherenceRate({ taken: 0, skipped: 0, total: 0 }), null);
});

test("longestOffStreakDays: finds the longest consecutive run, ignores gaps", () => {
  const timeline = [
    timelinePoint({ ts: "2026-07-18T08:00:00.000Z", state: "state_off" }),
    timelinePoint({ ts: "2026-07-19T08:00:00.000Z", state: "state_off" }),
    timelinePoint({ ts: "2026-07-19T20:00:00.000Z", state: "state_off" }), // same day, doesn't double-count
    timelinePoint({ ts: "2026-07-20T08:00:00.000Z", state: "state_off" }),
    // gap on 07-21 (no OFF that day)
    timelinePoint({ ts: "2026-07-22T08:00:00.000Z", state: "state_off" }),
  ];
  assert.equal(longestOffStreakDays(timeline), 3);
});

test("longestOffStreakDays: zero when no OFF states at all", () => {
  assert.equal(longestOffStreakDays([timelinePoint({ state: "state_on" })]), 0);
});

test("countFallsOrNearFalls: 'none' is the only non-flagged choice", () => {
  const responses = [
    response({ answer_value: { choice: "none" } }),
    response({ answer_value: { choice: "near_fall" } }),
    response({ answer_value: { choice: "fall_real" } }),
  ];
  assert.equal(countFallsOrNearFalls(responses), 2);
});

test("countFallsWithInjury: 'no_injury' is the only non-flagged choice", () => {
  const responses = [
    response({ answer_value: { choice: "no_injury" } }),
    response({ answer_value: { choice: "minor_injury" } }),
    response({ answer_value: { choice: "medical_attention" } }),
  ];
  assert.equal(countFallsWithInjury(responses), 2);
});

/**
 * คำตอบที่ถูกข้ามต้องไม่ถูกนับเป็นเหตุการณ์
 *
 * แถวที่ skipped จะมี answer_value ว่าง ({}) การเทียบ choice !== "ไม่เกิดเหตุ" จึงเป็นจริงเสมอ
 * ถ้าไม่กรองออก คนที่กดข้ามจะถูกนับว่าล้ม/บาดเจ็บทุกคน — ตัวเลขบน dashboard สูงเกินจริง
 */
test("ตัวนับทุกตัวไม่นับคำตอบที่ผู้ป่วยกดข้าม", () => {
  const skipped = [response({ answer_value: {}, skipped: true })];
  assert.equal(countFallsOrNearFalls(skipped), 0);
  assert.equal(countFallsWithInjury(skipped), 0);
  assert.deepEqual(countOrthostaticSignals(skipped), { repeatCount: 0, severeCount: 0 });
});

test("ข้ามบางข้อ ไม่กระทบการนับข้อที่ตอบจริง", () => {
  const mixed = [
    response({ answer_value: { choice: "none" } }),
    response({ answer_value: {}, skipped: true }),
    response({ answer_value: { choice: "fall_real" } }),
  ];
  assert.equal(countFallsOrNearFalls(mixed), 1);
});

test("countOrthostaticSignals: repeat (score>=1) vs severe (score>=3), per schema §9.5", () => {
  const responses = [
    response({ answer_value: { score: 0 } }), // no
    response({ answer_value: { score: 1 } }), // mild_once
    response({ answer_value: { score: 2 } }), // mild_repeat
    response({ answer_value: { score: 3 } }), // near_faint
    response({ answer_value: { score: 4 } }), // faint
  ];
  const result = countOrthostaticSignals(responses);
  assert.equal(result.repeatCount, 4);
  assert.equal(result.severeCount, 2);
});
