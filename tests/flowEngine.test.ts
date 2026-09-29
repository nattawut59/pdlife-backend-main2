import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCondition,
  validateAndNormalizeAnswer,
  type ResponseMap,
} from "../src/services/flowEngineService";
import type { ConditionJson, QuestionBankRow } from "../src/types/database";

function baseQuestion(overrides: Partial<QuestionBankRow> = {}): QuestionBankRow {
  return {
    question_code: "TEST_Q",
    qid: null,
    item_no: null,
    domain_code: "TEST",
    domain_name_th: null,
    question_full_th: "test",
    question_short_th: null,
    answer_type: "single_choice",
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

test("evaluateCondition: no show_if means always visible", () => {
  assert.equal(evaluateCondition({}, new Map()), true);
});

test("evaluateCondition: skipped source question -> condition not met", () => {
  const condition: ConditionJson = {
    show_if: { question_code: "SRC", operator: "==", value: "yes" },
  };
  const responses: ResponseMap = new Map([["SRC", { answer_value: {}, skipped: true }]]);
  assert.equal(evaluateCondition(condition, responses), false);
});

test("evaluateCondition: unanswered source question -> condition not met", () => {
  const condition: ConditionJson = {
    show_if: { question_code: "SRC", operator: "==", value: "yes" },
  };
  assert.equal(evaluateCondition(condition, new Map()), false);
});

test("evaluateCondition: score >= threshold (MOOD-04 gate shape from schema §9.2)", () => {
  const condition: ConditionJson = {
    show_if: {
      question_code: "MOOD_DEPRESSED_ANHEDONIA",
      operator: ">=",
      value: 2,
      field: "score",
    },
  };
  const below: ResponseMap = new Map([
    ["MOOD_DEPRESSED_ANHEDONIA", { answer_value: { choice: "1", score: 1 }, skipped: false }],
  ]);
  const atThreshold: ResponseMap = new Map([
    ["MOOD_DEPRESSED_ANHEDONIA", { answer_value: { choice: "2", score: 2 }, skipped: false }],
  ]);
  assert.equal(evaluateCondition(condition, below), false);
  assert.equal(evaluateCondition(condition, atThreshold), true);
});

test("evaluateCondition: in / not_in on choice", () => {
  const condition: ConditionJson = {
    show_if: { question_code: "SRC", operator: "in", value: ["fall_real"] },
  };
  const matching: ResponseMap = new Map([
    ["SRC", { answer_value: { choice: "fall_real" }, skipped: false }],
  ]);
  const nonMatching: ResponseMap = new Map([
    ["SRC", { answer_value: { choice: "no_fall" }, skipped: false }],
  ]);
  assert.equal(evaluateCondition(condition, matching), true);
  assert.equal(evaluateCondition(condition, nonMatching), false);
});

test("validateAndNormalizeAnswer: skipped short-circuits to empty answer", () => {
  const question = baseQuestion({ options_json: [{ code: "yes", label: "Yes", score: 1 }] });
  assert.deepEqual(validateAndNormalizeAnswer(question, undefined, true), {});
});

test("validateAndNormalizeAnswer: choice-based rejects unknown option code", () => {
  const question = baseQuestion({ options_json: [{ code: "yes", label: "Yes", score: 1 }] });
  assert.throws(() => validateAndNormalizeAnswer(question, { choice: "maybe" }, false));
});

test("validateAndNormalizeAnswer: score is always derived server-side, never trusted from client", () => {
  const question = baseQuestion({ options_json: [{ code: "yes", label: "Yes", score: 1 }] });
  const result = validateAndNormalizeAnswer(question, { choice: "yes", score: 999 }, false);
  assert.deepEqual(result, { choice: "yes", score: 1 });
});

test("validateAndNormalizeAnswer: matches by option.value as well as option.code", () => {
  const question = baseQuestion({ options_json: [{ value: "มี", label: "มี", score: null }] });
  const result = validateAndNormalizeAnswer(question, { choice: "มี" }, false);
  assert.deepEqual(result, { choice: "มี", score: null });
});

test("validateAndNormalizeAnswer: free-form question (no options) requires a non-empty object", () => {
  const question = baseQuestion({ options_json: [], answer_type: "text" });
  assert.throws(() => validateAndNormalizeAnswer(question, undefined, false));
  assert.throws(() => validateAndNormalizeAnswer(question, {}, false));
  assert.deepEqual(validateAndNormalizeAnswer(question, { text: "hello" }, false), { text: "hello" });
});

// ---------- single_choice_with_count: count เดิมเคยถูกทิ้งเสมอ (บั๊ก MOT-05 "เกือบล้มซ้ำ") ----------

function countQuestion() {
  return baseQuestion({
    answer_type: "single_choice_with_count",
    options_json: [
      { code: "none", label: "ไม่มีเลย", score: null },
      { code: "near_fall", label: "เกือบล้ม (ระบุจำนวนครั้ง)", score: null },
    ],
  });
}

test("validateAndNormalizeAnswer: single_choice_with_count เก็บ count ที่ถูกต้องไว้", () => {
  const result = validateAndNormalizeAnswer(countQuestion(), { choice: "near_fall", count: 2 }, false);
  assert.deepEqual(result, { choice: "near_fall", score: null, count: 2 });
});

test("validateAndNormalizeAnswer: single_choice_with_count ไม่ส่ง count มาก็ยังผ่าน (backward compat กับแอปเก่า)", () => {
  const result = validateAndNormalizeAnswer(countQuestion(), { choice: "near_fall" }, false);
  assert.deepEqual(result, { choice: "near_fall", score: null });
});

test("validateAndNormalizeAnswer: single_choice_with_count ปฏิเสธ count ที่ไม่ใช่จำนวนเต็มบวก", () => {
  assert.throws(() => validateAndNormalizeAnswer(countQuestion(), { choice: "near_fall", count: 0 }, false));
  assert.throws(() => validateAndNormalizeAnswer(countQuestion(), { choice: "near_fall", count: -1 }, false));
  assert.throws(() => validateAndNormalizeAnswer(countQuestion(), { choice: "near_fall", count: 1.5 }, false));
  assert.throws(() => validateAndNormalizeAnswer(countQuestion(), { choice: "near_fall", count: "2" }, false));
});

test("validateAndNormalizeAnswer: answer_type ธรรมดาไม่สนใจ count ที่ส่งมาเลย แม้จะไม่ใช่ตัวเลข", () => {
  const question = baseQuestion({ options_json: [{ code: "yes", label: "Yes", score: 1 }] });
  const result = validateAndNormalizeAnswer(question, { choice: "yes", count: "garbage" }, false);
  assert.deepEqual(result, { choice: "yes", score: 1 });
});

// ---------- single_choice_with_text: ข้อความเคยถูกทิ้งเสมอ (บั๊ก MOOD-03 "ระบุว่าเป็นเรื่องอะไร") ----------

function textQuestion() {
  return baseQuestion({
    answer_type: "single_choice_with_text",
    options_json: [
      { code: "no", label: "ไม่มี", score: null },
      { code: "yes", label: "มี (ระบุว่าเป็นเรื่องอะไร)", score: null },
    ],
  });
}

test("validateAndNormalizeAnswer: single_choice_with_text เก็บข้อความที่ผู้ตอบระบุไว้", () => {
  const result = validateAndNormalizeAnswer(
    textQuestion(),
    { choice: "yes", text: "เล่นการพนันออนไลน์ทุกคืน" },
    false,
  );
  assert.deepEqual(result, { choice: "yes", score: null, text: "เล่นการพนันออนไลน์ทุกคืน" });
});

test("validateAndNormalizeAnswer: single_choice_with_text ไม่ส่ง text มาก็ยังผ่าน (ผู้ป่วยมีสิทธิ์ไม่เล่าต่อ)", () => {
  const result = validateAndNormalizeAnswer(textQuestion(), { choice: "yes" }, false);
  assert.deepEqual(result, { choice: "yes", score: null });
});

test("validateAndNormalizeAnswer: single_choice_with_text ตัดช่องว่างหัวท้าย และทิ้งข้อความว่างล้วน", () => {
  assert.deepEqual(validateAndNormalizeAnswer(textQuestion(), { choice: "yes", text: "  ซื้อของ  " }, false), {
    choice: "yes",
    score: null,
    text: "ซื้อของ",
  });
  assert.deepEqual(validateAndNormalizeAnswer(textQuestion(), { choice: "yes", text: "   " }, false), {
    choice: "yes",
    score: null,
  });
});

test("validateAndNormalizeAnswer: single_choice_with_text ปฏิเสธ text ที่ไม่ใช่สตริง", () => {
  assert.throws(() => validateAndNormalizeAnswer(textQuestion(), { choice: "yes", text: 123 }, false));
  assert.throws(() => validateAndNormalizeAnswer(textQuestion(), { choice: "yes", text: { a: 1 } }, false));
});

test("validateAndNormalizeAnswer: answer_type ธรรมดาไม่สนใจ text ที่ส่งมาเลย", () => {
  const question = baseQuestion({ options_json: [{ code: "yes", label: "Yes", score: 1 }] });
  const result = validateAndNormalizeAnswer(question, { choice: "yes", text: "ไม่ควรถูกเก็บ" }, false);
  assert.deepEqual(result, { choice: "yes", score: 1 });
});
