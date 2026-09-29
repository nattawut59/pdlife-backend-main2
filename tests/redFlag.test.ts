import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkFallNearFallRule,
  checkMoodSafetyGate,
  checkOrthostaticPairedWithFall,
  checkStructuredRedFlagRule,
  describeAnswer,
} from "../src/services/redFlagService";
import type { QuestionBankRow, ResponseRow } from "../src/types/database";

function moodQuestion(): QuestionBankRow {
  return {
    question_code: "MOOD_SUICIDAL_IDEATION",
    qid: "MOOD-04",
    item_no: null,
    domain_code: "MOOD",
    domain_name_th: null,
    question_full_th: "test",
    question_short_th: null,
    answer_type: "single_choice_safety",
    options_json: [
      { code: "none", label: "ไม่เคย", score: 0 },
      { code: "sometimes", label: "มีบ้างเป็นบางครั้ง", score: 1 },
      { code: "often", label: "มีบ่อย", score: 2 },
      { code: "plan", label: "มีและเคยคิดวางแผน", score: 3 },
      { code: "no_answer", label: "ไม่ต้องการตอบ", score: null },
    ],
    condition_json: {},
    red_flag_json: { severity: "urgent", clinic_tag: "suicidal_ideation" },
    respondent: "patient_only",
    ui_input_hint: null,
    required_level: "core",
    summary_metric: null,
    mds_reference: null,
    license_source: null,
    terminology_binding: null,
    mvp_phase: "MVP1",
    version: 1,
    active: true,
    created_at: "",
    updated_at: "",
  };
}

test("MOOD-04 safety gate: 'none' is the only answer that does NOT flag", () => {
  const q = moodQuestion();
  assert.equal(checkMoodSafetyGate(q, { choice: "none", score: 0 }, false), null);
});

test("MOOD-04 safety gate: any other answer flags urgent/suicidal_ideation", () => {
  const q = moodQuestion();
  for (const choice of ["sometimes", "often", "plan", "no_answer"]) {
    const trigger = checkMoodSafetyGate(q, { choice, score: null }, false);
    assert.deepEqual(trigger, { clinic_tag: "suicidal_ideation", severity: "urgent" });
  }
});

test("MOOD-04 safety gate: fail-safe — an explicit skip also flags (per schema §9.4)", () => {
  const q = moodQuestion();
  const trigger = checkMoodSafetyGate(q, {}, true);
  assert.deepEqual(trigger, { clinic_tag: "suicidal_ideation", severity: "urgent" });
});

test("MOOD-04 safety gate: does not fire for unrelated questions", () => {
  const other: QuestionBankRow = { ...moodQuestion(), question_code: "MED_ONOFF_NOW" };
  assert.equal(checkMoodSafetyGate(other, { choice: "off", score: null }, false), null);
});

test("structured red flag rule: fires on score >= threshold (e.g. MED-07 dyskinesia_impairing)", () => {
  const q: QuestionBankRow = {
    ...moodQuestion(),
    question_code: "MED_DYSKINESIA_IMPAIRING",
    red_flag_json: {
      severity: "red",
      clinic_tag: "dyskinesia_impairing",
      rule: { operator: ">=", value: 3, field: "score" },
    },
  };
  assert.deepEqual(checkStructuredRedFlagRule(q, { choice: "3", score: 3 }), {
    clinic_tag: "dyskinesia_impairing",
    severity: "red",
  });
  assert.equal(checkStructuredRedFlagRule(q, { choice: "2", score: 2 }), null);
});

test("structured red flag rule: warning severity never writes a red flag row (§9.5)", () => {
  const q: QuestionBankRow = {
    ...moodQuestion(),
    question_code: "MED_ONOFF_NOW",
    red_flag_json: {
      severity: "warning",
      clinic_tag: "on_off_problem",
      rule: { operator: "==", value: "off" },
    },
  };
  assert.equal(checkStructuredRedFlagRule(q, { choice: "off", score: null }), null);
});

test("structured red flag rule: unstructured free-text rule is safely ignored, not guessed at", () => {
  const q: QuestionBankRow = {
    ...moodQuestion(),
    question_code: "MED_ONOFF_NOW",
    red_flag_json: {
      severity: "red",
      clinic_tag: "on_off_problem",
      rule: "answer_code == state_off (repeat >=3x / rolling 3 days)",
    },
  };
  assert.equal(checkStructuredRedFlagRule(q, { choice: "off", score: null }), null);
});

// ---------- STRUCTURED_RULE_OVERRIDES (constants.ts) — 11 ข้อที่เคยไม่ยิงเพราะ rule เป็น
// ข้อความอิสระ ทดสอบด้วยข้อความ rule ตัวจริงที่คัดลอกมาจาก seed/seed.sql (ไม่ใช่ rule ที่
// แต่งขึ้นเองแบบเทสด้านบน) เพื่อยืนยันว่า override ใช้ได้กับข้อมูลจริง ไม่ใช่แค่รูปแบบสมมติ

function realQuestion(
  code: string,
  severity: "red" | "urgent",
  clinic_tag: string,
  rule: string
): QuestionBankRow {
  return { ...moodQuestion(), question_code: code, red_flag_json: { severity, clinic_tag, rule } };
}

test("STRUCTURED_RULE_OVERRIDES: MED_DYSKINESIA_IMPACT (\"score >= 3\") ยิงเมื่อ score>=3", () => {
  const q = realQuestion("MED_DYSKINESIA_IMPACT", "red", "dyskinesia_impairing", "score >= 3");
  assert.deepEqual(checkStructuredRedFlagRule(q, { choice: "3", score: 3 }), {
    clinic_tag: "dyskinesia_impairing",
    severity: "red",
  });
  assert.equal(checkStructuredRedFlagRule(q, { choice: "2", score: 2 }), null);
});

test("STRUCTURED_RULE_OVERRIDES: MOTOR_WALK_BALANCE (\"score >= 3\") ยิงเมื่อ score>=3", () => {
  const q = realQuestion("MOTOR_WALK_BALANCE", "red", "mobility_severe", "score >= 3");
  assert.ok(checkStructuredRedFlagRule(q, { choice: "3", score: 3 }));
  assert.equal(checkStructuredRedFlagRule(q, { choice: "2", score: 2 }), null);
});

test("STRUCTURED_RULE_OVERRIDES: MOTOR_TREMOR_IMPACT (\"score >= 3\") ยิงเมื่อ score>=3", () => {
  const q = realQuestion("MOTOR_TREMOR_IMPACT", "red", "tremor_impairing", "score >= 3");
  assert.ok(checkStructuredRedFlagRule(q, { choice: "3", score: 3 }));
  assert.equal(checkStructuredRedFlagRule(q, { choice: "2", score: 2 }), null);
});

test("STRUCTURED_RULE_OVERRIDES: MOOD_DEPRESSED_ANHEDONIA (\"score >= 3\") ยิงเมื่อ score>=3", () => {
  const q = realQuestion("MOOD_DEPRESSED_ANHEDONIA", "red", "depression_high", "score >= 3");
  assert.ok(checkStructuredRedFlagRule(q, { choice: "3", score: 3 }));
  assert.equal(checkStructuredRedFlagRule(q, { choice: "2", score: 2 }), null);
});

test("STRUCTURED_RULE_OVERRIDES: MOOD_ANXIETY (\"score >= 3\") ยิงเมื่อ score>=3", () => {
  const q = realQuestion("MOOD_ANXIETY", "red", "anxiety_high", "score >= 3");
  assert.ok(checkStructuredRedFlagRule(q, { choice: "3", score: 3 }));
  assert.equal(checkStructuredRedFlagRule(q, { choice: "2", score: 2 }), null);
});

test("STRUCTURED_RULE_OVERRIDES: ADL_SWALLOWING (\"score >= 2\") ยิงเมื่อ score>=2", () => {
  const q = realQuestion("ADL_SWALLOWING", "red", "swallowing_choking", "score >= 2");
  assert.ok(checkStructuredRedFlagRule(q, { choice: "2", score: 2 }));
  assert.equal(checkStructuredRedFlagRule(q, { choice: "1", score: 1 }), null);
});

test("STRUCTURED_RULE_OVERRIDES: COG_HALLUCINATION (\"มี และไม่แน่ใจว่าจริงหรือไม่\") ยิงเฉพาะ c2 ไม่ยิง c1", () => {
  const q = realQuestion("COG_HALLUCINATION", "red", "hallucination", "มี และไม่แน่ใจว่าจริงหรือไม่");
  assert.ok(checkStructuredRedFlagRule(q, { choice: "c2" }));
  // c1 = "มีบ้าง แต่รู้ว่าไม่จริง" — มีอาการแต่ไม่เข้าเกณฑ์ rule เพราะรู้ว่าไม่จริง ต่างจาก c2
  assert.equal(checkStructuredRedFlagRule(q, { choice: "c1" }), null);
  assert.equal(checkStructuredRedFlagRule(q, { choice: "no" }), null);
});

test("STRUCTURED_RULE_OVERRIDES: COG_DELUSION (\"answer_code in [some, clear]\") ยิงทั้งสองระดับ", () => {
  const q = realQuestion("COG_DELUSION", "red", "psychosis_delusion", "answer_code in [some, clear]");
  assert.ok(checkStructuredRedFlagRule(q, { choice: "some" }));
  assert.ok(checkStructuredRedFlagRule(q, { choice: "clear" }));
  assert.equal(checkStructuredRedFlagRule(q, { choice: "none" }), null);
});

test("STRUCTURED_RULE_OVERRIDES: MOTOR_FALL_INJURY (\"บาดเจ็บที่ต้องพบแพทย์\") ยิงเฉพาะ medical_attention", () => {
  const q = realQuestion("MOTOR_FALL_INJURY", "urgent", "fall_injury", "บาดเจ็บที่ต้องพบแพทย์");
  assert.deepEqual(checkStructuredRedFlagRule(q, { choice: "medical_attention" }), {
    clinic_tag: "fall_injury",
    severity: "urgent",
  });
  assert.equal(checkStructuredRedFlagRule(q, { choice: "minor_injury" }), null);
});

test("STRUCTURED_RULE_OVERRIDES: AUTO_ORTHOSTATIC_SYMPTOM ยิงที่ score>=2 (ครอบ near_faint/faint แล้ว)", () => {
  // ข้อความจริง: "score >= 2 (เกิดซ้ำ) OR answer_code in [near_faint, faint] OR paired with
  // MOT-05 fall/near-fall same day" — เงื่อนไข "paired with MOT-05" ต้องเทียบข้ามคำถาม
  // ยังไม่ทำ (backlog แยกใน docs/HANDOVER.md) เพราะ evaluateStructuredRule ประเมินคำตอบเดียว
  const q = realQuestion(
    "AUTO_ORTHOSTATIC_SYMPTOM",
    "red",
    "orthostatic_symptom",
    "score >= 2 (เกิดซ้ำ)  OR  answer_code in [near_faint, faint]  OR  paired with MOT-05 fall/near-fall same day"
  );
  assert.ok(checkStructuredRedFlagRule(q, { choice: "mild_repeat", score: 2 }));
  assert.ok(checkStructuredRedFlagRule(q, { choice: "near_faint", score: 3 }));
  assert.equal(checkStructuredRedFlagRule(q, { choice: "mild_once", score: 1 }), null);
});

test("STRUCTURED_RULE_OVERRIDES: MOTOR_FALL_NEAR_FALL ไม่อยู่ในตารางนี้แล้ว — ย้ายไป checkFallNearFallRule ทั้งหมด", () => {
  const q = realQuestion("MOTOR_FALL_NEAR_FALL", "red", "fall_risk", "ล้มจริงๆ หรือ เกือบล้มซ้ำ");
  assert.equal(checkStructuredRedFlagRule(q, { choice: "fall_real" }), null);
});

// ---------- checkFallNearFallRule: MOT-05 "เกือบล้มซ้ำ" = count>=2 ในวันเดียวกัน (ยืนยันกับทีมแล้ว) ----------

test("checkFallNearFallRule: fall_real ยิงเสมอ แม้ count=1 หรือไม่มี count เลย", () => {
  const q = realQuestion("MOTOR_FALL_NEAR_FALL", "red", "fall_risk", "ล้มจริงๆ หรือ เกือบล้มซ้ำ");
  assert.deepEqual(checkFallNearFallRule(q, { choice: "fall_real" }), {
    clinic_tag: "fall_risk",
    severity: "red",
  });
  assert.ok(checkFallNearFallRule(q, { choice: "fall_real", count: 1 }));
});

test("checkFallNearFallRule: near_fall ครั้งเดียว (count=1 หรือไม่ส่ง count มาเลย) ไม่ยิง", () => {
  const q = realQuestion("MOTOR_FALL_NEAR_FALL", "red", "fall_risk", "ล้มจริงๆ หรือ เกือบล้มซ้ำ");
  assert.equal(checkFallNearFallRule(q, { choice: "near_fall", count: 1 }), null);
  assert.equal(checkFallNearFallRule(q, { choice: "near_fall" }), null, "ไม่มี count มาเลยถือเป็น 1 ครั้ง ปลอดภัยไว้ก่อน");
});

test("checkFallNearFallRule: near_fall ซ้ำ (count>=2) ยิง", () => {
  const q = realQuestion("MOTOR_FALL_NEAR_FALL", "red", "fall_risk", "ล้มจริงๆ หรือ เกือบล้มซ้ำ");
  assert.deepEqual(checkFallNearFallRule(q, { choice: "near_fall", count: 2 }), {
    clinic_tag: "fall_risk",
    severity: "red",
  });
  assert.ok(checkFallNearFallRule(q, { choice: "near_fall", count: 5 }));
});

test("checkFallNearFallRule: none ไม่ยิง และคำถามอื่นไม่ถูกแตะ", () => {
  const q = realQuestion("MOTOR_FALL_NEAR_FALL", "red", "fall_risk", "ล้มจริงๆ หรือ เกือบล้มซ้ำ");
  assert.equal(checkFallNearFallRule(q, { choice: "none" }), null);
  const other = realQuestion("MOTOR_FALL_INJURY", "urgent", "fall_injury", "บาดเจ็บที่ต้องพบแพทย์");
  assert.equal(checkFallNearFallRule(other, { choice: "fall_real" }), null);
});

// ---------- checkOrthostaticPairedWithFall: AUT-01 จับคู่กับคำตอบ MOT-05 ในรอบเดียวกัน ----------

function siblingResponse(questionCode: string, choice: string): ResponseRow {
  return {
    id: "r1",
    patient_id: "p1",
    round_instance_id: "round1",
    question_code: questionCode,
    question_version: 1,
    answer_value: { choice },
    skipped: false,
    answered_by_role: "patient",
    answered_at: "",
  };
}

test("checkOrthostaticPairedWithFall: MOT-05 ตอบ fall_real ในรอบเดียวกัน -> ยิง", () => {
  const q = realQuestion("AUTO_ORTHOSTATIC_SYMPTOM", "red", "orthostatic_symptom", "paired with MOT-05");
  const trigger = checkOrthostaticPairedWithFall(q, [siblingResponse("MOTOR_FALL_NEAR_FALL", "fall_real")]);
  assert.deepEqual(trigger, { clinic_tag: "orthostatic_symptom", severity: "red" });
});

test("checkOrthostaticPairedWithFall: MOT-05 ตอบ near_fall ในรอบเดียวกัน -> ยิงด้วย (ไม่ต้องเช็ค count)", () => {
  const q = realQuestion("AUTO_ORTHOSTATIC_SYMPTOM", "red", "orthostatic_symptom", "paired with MOT-05");
  const trigger = checkOrthostaticPairedWithFall(q, [siblingResponse("MOTOR_FALL_NEAR_FALL", "near_fall")]);
  assert.ok(trigger);
});

test("checkOrthostaticPairedWithFall: MOT-05 ตอบ none หรือไม่มีคำตอบ MOT-05 ในรอบเลย -> ไม่ยิง", () => {
  const q = realQuestion("AUTO_ORTHOSTATIC_SYMPTOM", "red", "orthostatic_symptom", "paired with MOT-05");
  assert.equal(checkOrthostaticPairedWithFall(q, [siblingResponse("MOTOR_FALL_NEAR_FALL", "none")]), null);
  assert.equal(checkOrthostaticPairedWithFall(q, []), null);
});

test("checkOrthostaticPairedWithFall: ไม่ใช่คำถาม AUT-01 -> ไม่ยิงแม้ MOT-05 ตอบ fall_real", () => {
  const other = realQuestion("MOTOR_FALL_INJURY", "urgent", "fall_injury", "บาดเจ็บที่ต้องพบแพทย์");
  assert.equal(checkOrthostaticPairedWithFall(other, [siblingResponse("MOTOR_FALL_NEAR_FALL", "fall_real")]), null);
});

test("STRUCTURED_RULE_OVERRIDES: ไม่มี MOOD_SUICIDAL_IDEATION อยู่ในตาราง (ยิงผ่าน checkMoodSafetyGate แยกต่างหากแล้ว)", () => {
  const q = realQuestion(
    "MOOD_SUICIDAL_IDEATION",
    "urgent",
    "suicidal_ideation",
    "answer_code != none  (รวม no_answer = fail-safe)"
  );
  assert.equal(checkStructuredRedFlagRule(q, { choice: "often", score: 2 }), null);
});

// ---------- แปลรหัสคำตอบเป็นข้อความไทยให้หมออ่าน ----------

const MOOD_OPTIONS = moodQuestion().options_json;

test("describeAnswer: แปลรหัสเป็นข้อความที่ผู้ป่วยเห็นตอนตอบ", () => {
  // "มีบ้างเป็นบางครั้ง" กับ "มีบ่อย" ยิงธง suicidal_ideation เหมือนกัน แต่ต่างกันในทางคลินิก
  assert.equal(describeAnswer({ choice: "sometimes" }, false, MOOD_OPTIONS), "มีบ้างเป็นบางครั้ง");
  assert.equal(describeAnswer({ choice: "plan" }, false, MOOD_OPTIONS), "มีและเคยคิดวางแผน");
});

test("describeAnswer: การข้ามคำถามต้องอ่านออกว่าข้าม ไม่ใช่ค่าว่าง", () => {
  // MOOD-04 ถือว่าการข้ามเป็น fail-safe ยิงธงด้วย หมอจึงต้องเห็นว่ามาจากการข้าม
  assert.equal(describeAnswer({}, true, MOOD_OPTIONS), "ผู้ป่วยข้ามคำถามนี้");
});

test("describeAnswer: รหัสที่หายไปจากคลังคำถามต้องบอกตรง ๆ ไม่ใช่โชว์รหัสดิบ", () => {
  const result = describeAnswer({ choice: "รหัสเก่าที่ถูกลบไปแล้ว" }, false, MOOD_OPTIONS);
  assert.match(result!, /ไม่พบตัวเลือกนี้ในคลังคำถามแล้ว/);
});

test("describeAnswer: ธงที่ไม่ได้มาจากคำตอบ (event log) ต้องได้ null ไม่ใช่พัง", () => {
  assert.equal(describeAnswer(undefined, undefined, undefined), null);
});

// ---------- count/text ต้องไปถึงหน้าจอ ไม่ใช่เก็บไว้เฉย ๆ ในฐานข้อมูล ----------

const FALL_OPTIONS = [
  { code: "none", label: "ไม่มีเลย", score: null },
  { code: "near_fall", label: "เกือบล้มแต่ทรงตัวได้ทัน (ระบุจำนวนครั้ง)", score: null },
];

const ICD_OPTIONS = [
  { code: "no", label: "ไม่มี", score: null },
  { code: "yes", label: "มี (ระบุว่าเป็นเรื่องอะไร)", score: null },
];

test("describeAnswer: จำนวนครั้งต้องแสดงด้วย เพราะมันคือเหตุผลที่ธงขึ้น", () => {
  // MOT-05 ยิงธงเมื่อ count >= 2 — ถ้าโชว์แต่ label พยาบาลเห็น "เกือบล้ม" โดยไม่รู้ว่ากี่ครั้ง
  assert.equal(
    describeAnswer({ choice: "near_fall", count: 3 }, false, FALL_OPTIONS),
    "เกือบล้มแต่ทรงตัวได้ทัน (ระบุจำนวนครั้ง) · 3 ครั้ง",
  );
});

test("describeAnswer: ข้อความที่ผู้ป่วยระบุต้องแสดงด้วย", () => {
  // MOOD-03 การพนัน/กินผิดปกติ/เรื่องเพศ เป็นคนละปัญหากันในแง่การดูแล
  assert.equal(
    describeAnswer({ choice: "yes", text: "เล่นการพนันออนไลน์ทุกคืน" }, false, ICD_OPTIONS),
    "มี (ระบุว่าเป็นเรื่องอะไร) · เล่นการพนันออนไลน์ทุกคืน",
  );
});

test("describeAnswer: คำตอบเก่าที่ไม่มี count/text ต้องได้ข้อความเดิมเป๊ะ ไม่มีตัวคั่นค้าง", () => {
  assert.equal(
    describeAnswer({ choice: "near_fall" }, false, FALL_OPTIONS),
    "เกือบล้มแต่ทรงตัวได้ทัน (ระบุจำนวนครั้ง)",
  );
  assert.equal(describeAnswer({ choice: "yes", text: "" }, false, ICD_OPTIONS), "มี (ระบุว่าเป็นเรื่องอะไร)");
});

test("describeAnswer: ข้ามคำถามยังต้องอ่านว่าข้าม แม้จะมี count/text ค้างมาด้วย", () => {
  assert.equal(describeAnswer({ count: 2, text: "x" }, true, FALL_OPTIONS), "ผู้ป่วยข้ามคำถามนี้");
});
