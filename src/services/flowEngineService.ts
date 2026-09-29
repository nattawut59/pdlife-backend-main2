import { ApiError } from "../utils/ApiError";
import type { AnswerValue, ConditionJson, QuestionBankRow } from "../types/database";
import type { TemplateQuestionWithBank } from "../repositories/questionBankRepository";

export interface AnsweredEntry {
  answer_value: AnswerValue;
  skipped: boolean;
}

export type ResponseMap = Map<string, AnsweredEntry>;

/**
 * §9.2 — operators: in, not_in, >=, <=, ==. field defaults to "choice".
 * If the source question was skipped or has no response yet, the condition is not met.
 */
export function evaluateCondition(condition: ConditionJson, responses: ResponseMap): boolean {
  const showIf = condition.show_if;
  if (!showIf) return true;

  const source = responses.get(showIf.question_code);
  if (!source || source.skipped) return false;

  const field = showIf.field ?? "choice";
  const actual = field === "score" ? source.answer_value.score : source.answer_value.choice;

  switch (showIf.operator) {
    case "in":
      return (
        Array.isArray(showIf.value) && actual != null && showIf.value.includes(String(actual))
      );
    case "not_in":
      return (
        Array.isArray(showIf.value) && (actual == null || !showIf.value.includes(String(actual)))
      );
    case ">=":
      return typeof actual === "number" && typeof showIf.value === "number" && actual >= showIf.value;
    case "<=":
      return typeof actual === "number" && typeof showIf.value === "number" && actual <= showIf.value;
    case "==":
      return actual === showIf.value;
    default:
      return false;
  }
}

/**
 * template_questions.condition_json overrides question_bank.condition_json when present
 * (schema §3: the question-level condition is only "default ระดับคำถาม (template ทับได้)").
 */
export function isQuestionVisible(tq: TemplateQuestionWithBank, responses: ResponseMap): boolean {
  const condition = tq.condition_json?.show_if != null ? tq.condition_json : tq.question_bank.condition_json;
  return evaluateCondition(condition, responses);
}

export function getVisibleQuestions(
  templateQuestions: TemplateQuestionWithBank[],
  responses: ResponseMap
): TemplateQuestionWithBank[] {
  return templateQuestions.filter((tq) => isQuestionVisible(tq, responses));
}

/**
 * Never trust a client-submitted score for choice-based answers — always re-derive it from
 * question_bank.options_json server-side so red-flag rules and dashboards can't be spoofed.
 */
export function validateAndNormalizeAnswer(
  question: QuestionBankRow,
  rawAnswerValue: unknown,
  skipped: boolean
): AnswerValue {
  if (skipped) {
    return {};
  }

  if (question.options_json.length === 0) {
    // Free-form answer types (number/text) — no fixed option set to validate against.
    if (typeof rawAnswerValue !== "object" || rawAnswerValue === null || Object.keys(rawAnswerValue).length === 0) {
      throw new ApiError(400, "answer_value is required unless skipped = true");
    }
    return rawAnswerValue as AnswerValue;
  }

  const choice =
    typeof rawAnswerValue === "object" && rawAnswerValue !== null
      ? (rawAnswerValue as AnswerValue).choice
      : undefined;
  if (!choice) {
    throw new ApiError(400, "answer_value.choice is required for this question");
  }

  const option = question.options_json.find((o) => o.code === choice || o.value === choice);
  if (!option) {
    throw new ApiError(400, `"${choice}" is not a valid option for ${question.question_code}`);
  }

  const normalized: AnswerValue = { choice, score: option.score };

  // answer_type นี้มีแค่ MOT-05 วันนี้ — ตัวเลือก "ระบุจำนวนครั้ง" ต้องมีเลขติดมาด้วยถึงจะรู้ว่า
  // เกิดซ้ำกี่ครั้งในวันนั้น เดิม normalize ทิ้งทุกอย่างนอกจาก choice/score ทำให้ count ที่แอปส่งมา
  // (ถ้าส่งมา) ไม่เคยไปถึงตอนประเมิน red flag เลย (ดู checkFallNearFallRule ใน redFlagService.ts)
  if (question.answer_type === "single_choice_with_count") {
    const rawCount = (rawAnswerValue as AnswerValue).count;
    if (rawCount !== undefined) {
      if (typeof rawCount !== "number" || !Number.isInteger(rawCount) || rawCount < 1) {
        throw new ApiError(400, "answer_value.count must be a positive integer");
      }
      normalized.count = rawCount;
    }
  }

  // เหตุผลเดียวกับ count ข้างบน — วันนี้มีข้อเดียวคือ MOOD-03 (การควบคุมแรงกระตุ้น) ที่ตัวเลือก
  // "มี" เขียนกำกับว่า "(ระบุว่าเป็นเรื่องอะไร)" ตัวข้อความคือสาระทางคลินิกทั้งหมดของคำตอบนั้น —
  // การพนัน กินผิดปกติ หรือเรื่องเพศ เป็นคนละเรื่องกันโดยสิ้นเชิงในแง่การดูแล ถ้า normalize ทิ้ง
  // หมอจะเห็นแค่ "มี" พร้อมธงเตือน แต่ไม่มีทางรู้ว่าเรื่องอะไร และข้อความนั้นหายถาวรตั้งแต่ตอนบันทึก
  if (question.answer_type === "single_choice_with_text") {
    const rawText = (rawAnswerValue as AnswerValue).text;
    if (rawText !== undefined) {
      if (typeof rawText !== "string") {
        throw new ApiError(400, "answer_value.text must be a string");
      }
      // ไม่บังคับว่าต้องกรอก (ผู้ป่วยมีสิทธิ์ตอบ "มี" แล้วไม่เล่าต่อ) แต่ถ้าส่งมาเป็นช่องว่างล้วน
      // ถือว่าไม่ได้ระบุ ดีกว่าเก็บสตริงว่างไว้ให้หน้าจอต้องเดาว่าแปลว่าอะไร
      const trimmed = rawText.trim();
      if (trimmed.length > 0) normalized.text = trimmed;
    }
  }

  return normalized;
}
