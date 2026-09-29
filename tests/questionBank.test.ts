import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRuleStatus, assembleQuestionBank } from "../src/services/questionBankService";
import type { QuestionBankRow, TemplateQuestionRow } from "../src/types/database";

function question(overrides: Partial<QuestionBankRow> = {}): QuestionBankRow {
  return {
    question_code: "TEST_Q",
    qid: "TST-01",
    item_no: 1,
    domain_code: "TEST",
    domain_name_th: "ทดสอบ",
    question_full_th: "คำถามทดสอบ",
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
    mvp_phase: "MVP1",
    version: 1,
    active: true,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

// ---------- classifyRuleStatus: ครบทั้ง 5 สถานะ ใช้ข้อมูลจริงจาก seed.sql ----------

test("classifyRuleStatus: ไม่มีกฎเลย (red_flag_json ว่าง)", () => {
  const q = question({ question_code: "OTHER_FATIGUE", red_flag_json: {} });
  assert.equal(classifyRuleStatus(q), "no_rule");
});

test("classifyRuleStatus: severity warning ถือว่า query-only ไม่ใช่ยังไม่ยิง", () => {
  // MED_ONOFF_NOW ตัวจริงจาก seed.sql
  const q = question({
    question_code: "MED_ONOFF_NOW",
    red_flag_json: {
      severity: "warning",
      clinic_tag: "on_off_problem",
      rule: "answer_code == state_off (repeat >=3 times in rolling 3 days)",
    },
  });
  assert.equal(classifyRuleStatus(q), "warning_only");
});

test("classifyRuleStatus: severity red แต่ยังเป็นข้อความอิสระและไม่มีใน override — ยังไม่ยิง", () => {
  // COG_ATTENTION-style: สมมติสร้าง severity red ใหม่ที่ไม่เคยอยู่ใน STRUCTURED_RULE_OVERRIDES
  const q = question({
    question_code: "SOME_UNCOVERED_QUESTION",
    red_flag_json: { severity: "red", clinic_tag: "example", rule: "some free text rule" },
  });
  assert.equal(classifyRuleStatus(q), "not_enforced");
});

test("classifyRuleStatus: severity red และมีใน STRUCTURED_RULE_OVERRIDES — ยิงจริง", () => {
  // MOTOR_TREMOR_IMPACT ตัวจริงจาก seed.sql ที่แก้ให้ยิงจริงแล้ววันนี้
  const q = question({
    question_code: "MOTOR_TREMOR_IMPACT",
    red_flag_json: { severity: "red", clinic_tag: "tremor_impairing", rule: "score >= 3" },
  });
  assert.equal(classifyRuleStatus(q), "enforced");
});

test("classifyRuleStatus: rule เป็น structured object อยู่แล้วในข้อมูล — ยิงจริงเหมือนกัน", () => {
  const q = question({
    question_code: "SOME_UNCOVERED_QUESTION",
    red_flag_json: {
      severity: "urgent",
      clinic_tag: "example",
      rule: { operator: ">=", value: 3, field: "score" },
    },
  });
  assert.equal(classifyRuleStatus(q), "enforced");
});

test("classifyRuleStatus: MOOD_SUICIDAL_IDEATION เป็น safety_gate เสมอ ไม่ว่า red_flag_json จะหน้าตาแบบไหน", () => {
  const q = question({
    question_code: "MOOD_SUICIDAL_IDEATION",
    red_flag_json: { severity: "urgent", clinic_tag: "suicidal_ideation", rule: "answer_code != none" },
  });
  assert.equal(classifyRuleStatus(q), "safety_gate");
});

// ---------- assembleQuestionBank: จับคู่คำถามกับรอบที่ใช้ ----------

function templateQuestion(overrides: Partial<TemplateQuestionRow> = {}): TemplateQuestionRow {
  return {
    id: "tq-1",
    template_code: "EVENING_DAILY_CORE",
    question_code: "TEST_Q",
    sort_order: 1,
    required: true,
    condition_json: {},
    ui_note_th: null,
    ...overrides,
  };
}

test("assembleQuestionBank: คำถามที่อยู่หลายรอบได้ template_codes ครบทุกรอบ", () => {
  const [entry] = assembleQuestionBank(
    [question({ question_code: "MOTOR_TREMOR_IMPACT" })],
    [
      templateQuestion({ id: "1", question_code: "MOTOR_TREMOR_IMPACT", template_code: "EVENING_DAILY_CORE" }),
      templateQuestion({ id: "2", question_code: "MOTOR_TREMOR_IMPACT", template_code: "PREVISIT_7D_FORM" }),
    ],
  );
  assert.deepEqual(entry.template_codes.sort(), ["EVENING_DAILY_CORE", "PREVISIT_7D_FORM"]);
});

test("assembleQuestionBank: คำถามที่ไม่อยู่รอบไหนเลยได้ array ว่าง ไม่ใช่ undefined", () => {
  const [entry] = assembleQuestionBank([question({ question_code: "LONELY_Q" })], []);
  assert.deepEqual(entry.template_codes, []);
});

test("assembleQuestionBank: ไม่ยัด template ของคำถามอื่นเข้าผิดคำถาม", () => {
  const entries = assembleQuestionBank(
    [question({ question_code: "Q1" }), question({ question_code: "Q2" })],
    [templateQuestion({ id: "1", question_code: "Q1", template_code: "MORNING_CHECKIN" })],
  );
  const q1 = entries.find((e) => e.question_code === "Q1")!;
  const q2 = entries.find((e) => e.question_code === "Q2")!;
  assert.deepEqual(q1.template_codes, ["MORNING_CHECKIN"]);
  assert.deepEqual(q2.template_codes, []);
});
