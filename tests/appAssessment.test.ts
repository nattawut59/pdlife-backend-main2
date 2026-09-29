import { test } from "node:test";
import assert from "node:assert/strict";
import { isFlagged, delayOrSuboptimalFlags } from "../src/services/appAssessmentService";
import type { ResponseWithQuestion } from "../src/repositories/responseRepository";
import type { QuestionBankRow } from "../src/types/database";

function baseQuestion(overrides: Partial<QuestionBankRow> = {}): QuestionBankRow {
  return {
    question_code: "TEST_Q",
    qid: null,
    item_no: null,
    domain_code: "TEST",
    domain_name_th: null,
    question_full_th: "test",
    question_short_th: null,
    answer_type: "ordinal_scale_0_4",
    options_json: [],
    condition_json: {},
    red_flag_json: {},
    respondent: "both",
    ui_input_hint: null,
    required_level: null,
    summary_metric: null,
    mds_reference: null,
    license_source: null,
    terminology_binding: null,
    mvp_phase: null,
    version: 1,
    active: true,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function row(overrides: {
  answer_value: ResponseWithQuestion["answer_value"];
  skipped?: boolean;
  question?: Partial<QuestionBankRow>;
}): ResponseWithQuestion {
  return {
    id: "r1",
    patient_id: "p1",
    round_instance_id: "ri1",
    question_code: overrides.question?.question_code ?? "TEST_Q",
    question_version: 1,
    answer_value: overrides.answer_value,
    skipped: overrides.skipped ?? false,
    answered_by_role: "patient",
    answered_at: "2026-08-30T00:00:00.000Z",
    question_bank: baseQuestion(overrides.question),
  };
}

// ---------- isFlagged: structured rule takes priority ----------

test("isFlagged: ใช้ threshold ของ structured rule เมื่อมี (score >= 3)", () => {
  const q = { red_flag_json: { rule: { operator: ">=", value: 3, field: "score" } } };
  assert.equal(isFlagged(row({ answer_value: { score: 3 }, question: q })), true);
  assert.equal(isFlagged(row({ answer_value: { score: 2 }, question: q })), false);
});

test("isFlagged: ใช้ STRUCTURED_RULE_OVERRIDES เมื่อ rule ในคำถามยังเป็นข้อความอิสระ (MOTOR_TREMOR_IMPACT)", () => {
  // เกณฑ์เดียวกับที่ตอนนี้ใช้ยิง red flag จริงแล้ว (tests/redFlag.test.ts) — ตารางเทียบ
  // แอป/พยาบาลจึงใช้ threshold เดียวกับที่หมอเห็นในที่อื่นของระบบตามที่ตั้งใจไว้แต่แรก
  const q = {
    question_code: "MOTOR_TREMOR_IMPACT",
    red_flag_json: { severity: "red" as const, clinic_tag: "tremor_impairing", rule: "score >= 3" },
  };
  assert.equal(isFlagged(row({ answer_value: { score: 2 }, question: q })), false);
  assert.equal(isFlagged(row({ answer_value: { score: 3 }, question: q })), true);
});

test("isFlagged: structured rule แบบ choice ==", () => {
  const q = { red_flag_json: { rule: { operator: "==", value: "off" } } };
  assert.equal(isFlagged(row({ answer_value: { choice: "off" }, question: q })), true);
  assert.equal(isFlagged(row({ answer_value: { choice: "on" }, question: q })), false);
});

// ---------- isFlagged: non-baseline fallback เมื่อไม่มี structured rule ----------

test("isFlagged: ไม่มี rule — ordinal score > 0 ถือว่า flagged", () => {
  assert.equal(isFlagged(row({ answer_value: { score: 0 } })), false);
  assert.equal(isFlagged(row({ answer_value: { score: 1 } })), true);
});

test("isFlagged: ไม่มี rule — choice ที่ไม่ใช่ no/none ถือว่า flagged", () => {
  assert.equal(isFlagged(row({ answer_value: { choice: "no" } })), false);
  assert.equal(isFlagged(row({ answer_value: { choice: "none" } })), false);
  assert.equal(isFlagged(row({ answer_value: { choice: "yes" } })), true);
});

test("isFlagged: SLEEP_NOCTURIA ใช้ c1 (0 ครั้ง) เป็น baseline ไม่ใช่ no/none", () => {
  const q = { question_code: "SLEEP_NOCTURIA" };
  assert.equal(isFlagged(row({ answer_value: { choice: "c1" }, question: q })), false);
  assert.equal(isFlagged(row({ answer_value: { choice: "c5" }, question: q })), true);
});

// ---------- isFlagged: ข้ามคำถามไม่นับว่ามีอาการ ----------

test("isFlagged: ข้ามคำถามต้องได้ false เสมอ แม้คะแนนที่ค้างอยู่จะเข้าเกณฑ์", () => {
  const q = { red_flag_json: { rule: { operator: ">=", value: 1, field: "score" } } };
  assert.equal(isFlagged(row({ answer_value: { score: 3 }, skipped: true, question: q })), false);
});

// ---------- mf_delay_on / mf_suboptimal_on แยกจากคำตอบเดียว ----------

test("delayOrSuboptimalFlags: c1 = delay เท่านั้น", () => {
  assert.deepEqual(delayOrSuboptimalFlags(row({ answer_value: { choice: "c1" } })), {
    delay: true,
    suboptimal: false,
  });
});

test("delayOrSuboptimalFlags: c2 = suboptimal เท่านั้น", () => {
  assert.deepEqual(delayOrSuboptimalFlags(row({ answer_value: { choice: "c2" } })), {
    delay: false,
    suboptimal: true,
  });
});

test("delayOrSuboptimalFlags: c3 = ทั้งสองอย่าง", () => {
  assert.deepEqual(delayOrSuboptimalFlags(row({ answer_value: { choice: "c3" } })), {
    delay: true,
    suboptimal: true,
  });
});

test("delayOrSuboptimalFlags: no = ไม่ทั้งคู่", () => {
  assert.deepEqual(delayOrSuboptimalFlags(row({ answer_value: { choice: "no" } })), {
    delay: false,
    suboptimal: false,
  });
});

test("delayOrSuboptimalFlags: ข้ามคำถาม = ไม่ทั้งคู่", () => {
  assert.deepEqual(delayOrSuboptimalFlags(row({ answer_value: {}, skipped: true })), {
    delay: false,
    suboptimal: false,
  });
});
