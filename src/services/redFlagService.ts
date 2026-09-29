import {
  createRedFlag,
  findRedFlagById,
  listRedFlagsForPatient,
  setRedFlagReviewed,
} from "../repositories/redFlagRepository";
import { ApiError } from "../utils/ApiError";
import { assertCanAccessPatient } from "./patientAccessService";
import type {
  AnswerValue,
  QuestionBankRow,
  QuestionOption,
  RedFlagRow,
  RedFlagRule,
  ResponseRow,
  StructuredRedFlagRule,
} from "../types/database";
import { NEAR_FALL_REPEAT_THRESHOLD, STRUCTURED_RULE_OVERRIDES, type FlagSeverity } from "../config/constants";
import type { JwtPayload } from "../utils/jwt";

/** Confirmed via docs/PDLIFE_Question_Bank_master_v1.xlsx (template_questions sheet) — not guessed. */
export const MOOD_SUICIDAL_QUESTION_CODE = "MOOD_SUICIDAL_IDEATION";
const MOOD_SUICIDAL_SAFE_CODE = "none";

export interface RedFlagTrigger {
  clinic_tag: string;
  severity: FlagSeverity;
}

/**
 * §9.4 — MOOD-04 safety gate. Any answer other than "none", including no_answer and an
 * explicit skip, is fail-safe: treated as a flag. This is the one red_flag_json rule the
 * schema fully specifies end-to-end, so it's hardcoded here rather than interpreted generically.
 */
export function checkMoodSafetyGate(
  question: QuestionBankRow,
  answerValue: AnswerValue,
  skipped: boolean
): RedFlagTrigger | null {
  if (question.question_code !== MOOD_SUICIDAL_QUESTION_CODE) return null;
  if (!skipped && answerValue.choice === MOOD_SUICIDAL_SAFE_CODE) return null;

  return { clinic_tag: "suicidal_ideation", severity: "urgent" };
}

/**
 * MOT-05 ("ล้มจริงๆ หรือ เกือบล้มซ้ำ") — ไม่อยู่ใน STRUCTURED_RULE_OVERRIDES เพราะกติกาเป็น OR
 * ของสอง field คนละแบบ (fall_real ยิงเสมอไม่ว่า count เท่าไหร่, near_fall ต้อง count>=threshold)
 * ซึ่งรูปแบบ {operator,value,field} เดี่ยวของระบบ generic รองรับไม่ได้ — เขียนเฉพาะเหมือน
 * checkMoodSafetyGate
 *
 * ไม่มี count มาเลย (เช่นแอปเวอร์ชันเก่าที่ยังไม่ส่ง) ถือเป็น 1 ครั้ง — ไม่ยิงสำหรับ near_fall
 * เดี่ยวๆ ปลอดภัยไว้ก่อนดีกว่าเดาว่าเกิดซ้ำ
 */
export function checkFallNearFallRule(
  question: QuestionBankRow,
  answerValue: AnswerValue
): RedFlagTrigger | null {
  if (question.question_code !== "MOTOR_FALL_NEAR_FALL") return null;

  const isFallReal = answerValue.choice === "fall_real";
  const isRepeatedNearFall =
    answerValue.choice === "near_fall" && (answerValue.count ?? 1) >= NEAR_FALL_REPEAT_THRESHOLD;
  if (!isFallReal && !isRepeatedNearFall) return null;

  return { clinic_tag: "fall_risk", severity: "red" };
}

/**
 * AUT-01 ("...OR paired with MOT-05 fall/near-fall same day") — MOT-05 (item_no 12) ถูกถามก่อน
 * AUT-01 (item_no 23) ในรอบ EVENING_DAILY_CORE เดียวกันเสมอ จึง "same day" = คำตอบพี่น้องใน
 * round_instance เดียวกัน ไม่ใช่ query ย้อนหลังข้ามวัน — รับ siblingResponses มาให้แล้วเพื่อให้
 * เป็น pure function เทสได้โดยไม่ต้องต่อ DB (ผู้เรียกใน responseService.ts เป็นคนดึงมาจาก
 * responseRepository.listByRound)
 *
 * เช็คแค่ "มีเหตุการณ์ล้ม/เกือบล้มเกิดขึ้นวันเดียวกันไหม" ไม่เช็ค count — ต่างจากกติกาของ MOT-05
 * เอง (checkFallNearFallRule) ที่ near_fall เดี่ยวๆ ไม่พอ ต้อง count>=threshold
 */
export function checkOrthostaticPairedWithFall(
  question: QuestionBankRow,
  siblingResponses: ResponseRow[]
): RedFlagTrigger | null {
  if (question.question_code !== "AUTO_ORTHOSTATIC_SYMPTOM") return null;

  const fallResponse = siblingResponses.find((r) => r.question_code === "MOTOR_FALL_NEAR_FALL");
  const fallChoice = fallResponse?.answer_value?.choice;
  if (fallChoice !== "fall_real" && fallChoice !== "near_fall") return null;

  return { clinic_tag: "orthostatic_symptom", severity: "red" };
}

/** ดึงกฎ structured จาก rule.rule เอง หรือจาก STRUCTURED_RULE_OVERRIDES เมื่อ rule.rule เป็นข้อความอิสระ */
function resolveStructuredRule(
  rule: RedFlagRule,
  questionCode: string
): StructuredRedFlagRule | null {
  const raw = rule.rule;
  if (
    typeof raw === "object" &&
    raw !== null &&
    "operator" in raw &&
    "value" in raw
  ) {
    return raw as StructuredRedFlagRule;
  }
  return STRUCTURED_RULE_OVERRIDES[questionCode] ?? null;
}

/**
 * ตีความ red_flag_json.rule เมื่อเป็นรูปแบบ structured {operator,value,field} ตาม §9.2 —
 * หรือเมื่อ questionCode มีอยู่ใน STRUCTURED_RULE_OVERRIDES (constants.ts) ซึ่ง transcribe
 * มาจากข้อความอิสระจริงในคำถามที่ยืนยันความหมายแล้ว ไม่ได้เดา
 *
 * คืน null เมื่อไม่มีทั้งสองแบบ (ข้อมูลจริงส่วนใหญ่ยังเป็นข้อความอิสระที่ยังไม่ได้ยืนยัน —
 * ไม่เดาความหมายของข้อความนั้น) — แยกออกมาจาก checkStructuredRedFlagRule เพื่อให้
 * appAssessmentService เอาไปใช้กับกฎระดับ warning ได้ด้วย (checkStructuredRedFlagRule
 * จำกัดแค่ red/urgent เพราะ §9.5 ให้ warning เป็น query-only สำหรับ red_flags table
 * แต่ตารางเทียบแอป/พยาบาลไม่ได้ผูกกับ severity นั้น)
 */
export function evaluateStructuredRule(
  rule: RedFlagRule,
  answerValue: AnswerValue,
  questionCode: string
): boolean | null {
  const structuredRule = resolveStructuredRule(rule, questionCode);
  if (!structuredRule) return null;

  const { operator, value, field } = structuredRule;
  const actual = field === "score" ? answerValue.score : answerValue.choice;

  if (operator === ">=" && typeof actual === "number" && typeof value === "number") {
    return actual >= value;
  } else if (operator === "<=" && typeof actual === "number" && typeof value === "number") {
    return actual <= value;
  } else if (operator === "==") {
    return actual === value;
  } else if (operator === "in" && Array.isArray(value)) {
    return actual != null && value.includes(String(actual));
  } else if (operator === "not_in" && Array.isArray(value)) {
    return actual == null || !value.includes(String(actual));
  }
  return null;
}

/**
 * Hook for question_bank.red_flag_json rows seeded in the structured {operator,value,field}
 * shape from §9.2. Only fires for rows whose rule is already structured and severity is
 * red/urgent (warning stays query-only per §9.5).
 */
export function checkStructuredRedFlagRule(
  question: QuestionBankRow,
  answerValue: AnswerValue
): RedFlagTrigger | null {
  const rule = question.red_flag_json;
  if (rule.severity !== "red" && rule.severity !== "urgent") return null;
  if (!rule.clinic_tag) return null;

  const matched = evaluateStructuredRule(rule, answerValue, question.question_code);
  return matched ? { clinic_tag: rule.clinic_tag, severity: rule.severity } : null;
}

export async function raiseRedFlag(
  patientId: string,
  responseId: string,
  questionCode: string,
  trigger: RedFlagTrigger
): Promise<void> {
  await createRedFlag({
    patient_id: patientId,
    response_id: responseId,
    question_code: questionCode,
    clinic_tag: trigger.clinic_tag,
    severity: trigger.severity,
  });
}

/** เหมือน raiseRedFlag แต่ธงมาจาก event_logs ไม่ใช่คำตอบในแบบสอบถาม — ผูก event_log_id แทน response_id/question_code */
export async function raiseRedFlagForEvent(
  patientId: string,
  eventLogId: string,
  trigger: RedFlagTrigger
): Promise<void> {
  await createRedFlag({
    patient_id: patientId,
    event_log_id: eventLogId,
    clinic_tag: trigger.clinic_tag,
    severity: trigger.severity,
  });
}

/** ตรงกับ STAFF_ROLES ใน patientAccessService — ธงเป็นข้อมูลระดับคลินิก ผู้ป่วย/ผู้ดูแลเข้าไม่ได้ */
const STAFF_ROLES: ReadonlySet<string> = new Set(["nurse", "doctor", "admin"]);

// ---------- อ่านธงกลับมาให้เจ้าหน้าที่ดู ----------

/**
 * จำนวนวันย้อนหลังเริ่มต้น — ยาวกว่า dashboard/warnings (7 วัน) โดยตั้งใจ
 *
 * ตัวนับบน dashboard ตอบคำถามว่า "ช่วงนี้เป็นยังไงบ้าง" จึงมองสั้น ๆ ได้ แต่ธงระดับ
 * red/urgent ตอบคำถามว่า "มีอะไรที่ยังไม่มีใครดูไหม" ซึ่งค้างข้ามสัปดาห์ได้ ถ้าใช้ 7 วัน
 * เท่ากัน ธงที่ยังไม่มีใครรับทราบจะหายไปจากหน้าจอเองเมื่อครบสัปดาห์ ทั้งที่ยังไม่ถูกจัดการ
 */
export const DEFAULT_WINDOW_DAYS = 30;

export interface RedFlagView {
  id: string;
  severity: FlagSeverity;
  clinic_tag: string;
  question_code: string | null;
  /** ข้อความคำถามภาษาไทย — null เมื่อธงมาจาก event log ไม่ใช่คำตอบ */
  question_th: string | null;
  /** คำตอบที่ผู้ป่วยเลือก แปลเป็นภาษาไทยแล้ว */
  answer_th: string | null;
  answered_at: string | null;
  reviewed: boolean;
  created_at: string;
}

/**
 * แปลรหัสคำตอบเป็นข้อความที่ผู้ป่วยเห็นตอนตอบ
 *
 * ตั้งใจไม่ fallback เป็นรหัสดิบเมื่อหาไม่เจอ — ถ้าคลังคำถามถูกแก้จนรหัสเก่าหายไป
 * การโชว์ "fall_real" ให้หมออ่านแย่กว่าการบอกตรง ๆ ว่าแปลไม่ได้
 *
 * ต่อท้ายด้วย count/text ที่ผู้ป่วยระบุมาด้วยเสมอ เพราะสองค่านี้คือ "สาระ" ของคำตอบ ไม่ใช่
 * ส่วนเสริม — MOT-05 ยิงธงก็เพราะ count >= 2 ถ้าโชว์แต่ label พยาบาลจะเห็นว่า "เกือบล้ม"
 * โดยไม่รู้ว่ากี่ครั้ง ทั้งที่ตัวเลขนั้นคือเหตุผลที่ธงขึ้น ส่วน MOOD-03 ที่ให้ระบุว่าเป็นเรื่องอะไร
 * การพนัน/กินผิดปกติ/เรื่องเพศ ก็เป็นคนละปัญหากันในแง่การดูแล
 *
 * ใช้ร่วมกันสองจอ (รายการธงเตือน กับ ตารางเทียบ "แอป vs พยาบาล") จึงแก้ที่นี่ที่เดียวพอ
 */
export function describeAnswer(
  answerValue: AnswerValue | undefined,
  skipped: boolean | undefined,
  options: QuestionOption[] | undefined
): string | null {
  if (skipped) return "ผู้ป่วยข้ามคำถามนี้";
  const choice = answerValue?.choice;
  if (choice == null) return null;

  const option = (options ?? []).find((o) => (o.code ?? o.value) === choice);
  const label = option ? option.label : `(ไม่พบตัวเลือกนี้ในคลังคำถามแล้ว: ${choice})`;

  // ไม่ต้องเช็ค answer_type ที่นี่ — validateAndNormalizeAnswer เก็บสองค่านี้ให้เฉพาะคำถาม
  // ที่รองรับอยู่แล้ว มีอยู่ในข้อมูลแปลว่าผ่านการตรวจมาแล้ว
  const detail: string[] = [];
  if (typeof answerValue?.count === "number") detail.push(`${answerValue.count} ครั้ง`);
  if (typeof answerValue?.text === "string" && answerValue.text.length > 0) {
    detail.push(answerValue.text);
  }

  return detail.length > 0 ? `${label} · ${detail.join(" · ")}` : label;
}

export async function listForPatient(
  requester: JwtPayload,
  patientId: string,
  options: { days?: number; onlyUnreviewed?: boolean } = {}
): Promise<{ window: { from: string; to: string }; flags: RedFlagView[] }> {
  await assertCanAccessPatient(requester, patientId);

  const days = options.days ?? DEFAULT_WINDOW_DAYS;
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const rows = await listRedFlagsForPatient(patientId, fromIso, options.onlyUnreviewed);

  return {
    window: { from: fromIso, to: toIso },
    flags: rows.map((row) => ({
      id: row.id,
      severity: row.severity,
      clinic_tag: row.clinic_tag,
      question_code: row.question_code,
      question_th: row.question_bank?.question_full_th ?? null,
      answer_th: describeAnswer(
        row.responses?.answer_value,
        row.responses?.skipped,
        row.question_bank?.options_json
      ),
      answered_at: row.responses?.answered_at ?? null,
      reviewed: row.reviewed,
      created_at: row.created_at,
    })),
  };
}

/**
 * กดรับทราบ / ยกเลิกการรับทราบ
 *
 * เจ้าหน้าที่คลินิกเท่านั้น — route กันด้วย requireRole อีกชั้น ตรวจซ้ำที่นี่เพราะ service
 * เป็นด่านจริงเมื่อ backend ใช้ service-role key ที่ข้าม RLS ทั้งหมด
 */
export async function markReviewed(
  requester: JwtPayload,
  flagId: string,
  reviewed: boolean
): Promise<RedFlagRow> {
  if (!STAFF_ROLES.has(requester.role)) {
    throw new ApiError(403, "Only clinic staff can review red flags");
  }

  const flag = await findRedFlagById(flagId);
  if (!flag) throw new ApiError(404, "Red flag not found");

  return setRedFlagReviewed(flagId, requester.sub, reviewed);
}
