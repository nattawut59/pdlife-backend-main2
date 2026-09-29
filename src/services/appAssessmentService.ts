import { listLatestForQuestions, type ResponseWithQuestion } from "../repositories/responseRepository";
import { assertCanAccessPatient } from "./patientAccessService";
import { describeAnswer, evaluateStructuredRule } from "./redFlagService";
import {
  ASSESSMENT_ITEM_KEYS,
  ASSESSMENT_KEY_QUESTION_CODES,
  DELAY_OR_SUBOPTIMAL_QUESTION_CODE,
  NON_STANDARD_BASELINE_CHOICE,
  type AssessmentItemKey,
} from "../config/constants";
import type { AnswerValue } from "../types/database";
import type { JwtPayload } from "../utils/jwt";

/**
 * ตารางเทียบ "แอป vs พยาบาล" (docs/HANDOVER.md ข้อ 5.1) — แปลงคำตอบล่าสุดของผู้ป่วยในแอป
 * ให้อยู่ในรูปเดียวกับฟอร์มคัดกรอง 26 ข้อของพยาบาล
 */

export interface AppAnswer {
  /** ข้อความคำตอบที่ผู้ป่วยเห็นตอนตอบ — null เมื่อยังไม่มีคำตอบในช่วงเวลานี้ */
  answer: string | null;
  flagged: boolean;
  answered_at: string;
}

export type AppAnswers = Partial<Record<AssessmentItemKey, AppAnswer>>;

/**
 * มีอาการหรือไม่จากคำตอบเดียว
 *
 * ใช้ threshold ของ red_flag_json.rule เมื่อเป็น structured rule (ตรงกับเกณฑ์ที่ระบบใช้ยิง
 * red flag จริง จึงเป็นเกณฑ์เดียวกับที่หมอเห็นในที่อื่นของระบบ) ไม่มีให้ถือว่า flagged เมื่อ
 * คำตอบไม่ใช่ baseline (score > 0 หรือ choice ที่ไม่ใช่ no/none) — เกณฑ์ตกลงกับทีมไว้แล้ว
 *
 * ข้ามคำถามไม่นับว่ามีอาการ — "ไม่รู้" กับ "มี" เป็นคนละเรื่อง ปนกันจะทำให้ตัวเลข
 * "ต่างกัน N ข้อ" สูงเกินจริงจากคำถามที่ผู้ป่วยแค่ข้าม ไม่ได้ตอบว่ามีอาการ
 */
export function isFlagged(row: ResponseWithQuestion): boolean {
  if (row.skipped) return false;

  const structured = evaluateStructuredRule(
    row.question_bank.red_flag_json,
    row.answer_value,
    row.question_code
  );
  if (structured !== null) return structured;

  return isNonBaseline(row.question_code, row.answer_value);
}

/**
 * ค่า baseline ปกติของ single_choice/boolean คือ "no"/"none" — บางคำถามใช้ระบบนับจำนวนครั้ง
 * (เช่น SLEEP_NOCTURIA: c1="0 ครั้ง") ซึ่ง "ไม่มีอาการ" ไม่ใช่ "no"/"none" ต้องเช็ค
 * NON_STANDARD_BASELINE_CHOICE ก่อนเสมอ ไม่งั้นคำตอบปกติจะถูกนับว่ามีอาการผิดพลาด
 */
function isNonBaseline(questionCode: string, answerValue: AnswerValue): boolean {
  if (typeof answerValue.score === "number") return answerValue.score > 0;

  const choice = answerValue.choice;
  if (choice == null) return false;

  const baseline = NON_STANDARD_BASELINE_CHOICE[questionCode] ?? "no";
  return choice !== baseline && choice !== "none";
}

/**
 * MED_DELAYED_OR_SUBOPTIMAL_ON ข้อเดียวตอบได้ 4 แบบ (no/c1/c2/c3) แต่ต้องแยกลงสองข้อของ
 * พยาบาล — c1 = delay เท่านั้น, c2 = suboptimal เท่านั้น, c3 = ทั้งคู่ (ดู constants.ts)
 */
export function delayOrSuboptimalFlags(row: ResponseWithQuestion): { delay: boolean; suboptimal: boolean } {
  if (row.skipped) return { delay: false, suboptimal: false };
  const choice = row.answer_value.choice;
  return {
    delay: choice === "c1" || choice === "c3",
    suboptimal: choice === "c2" || choice === "c3",
  };
}

export async function getAppAnswers(
  requester: JwtPayload,
  patientId: string,
  days = 7
): Promise<{ window: { from: string; to: string }; answers: AppAnswers }> {
  await assertCanAccessPatient(requester, patientId);

  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const questionCodes = [
    ...new Set(Object.values(ASSESSMENT_KEY_QUESTION_CODES).filter((code): code is string => code !== null)),
  ];

  const rows = await listLatestForQuestions(patientId, questionCodes, fromIso);
  // เรียงใหม่ไปเก่ามาแล้วจาก repository — เก็บแถวแรกสุดต่อ question_code (คำตอบล่าสุด)
  const latestByQuestion = new Map<string, ResponseWithQuestion>();
  for (const row of rows) {
    if (!latestByQuestion.has(row.question_code)) latestByQuestion.set(row.question_code, row);
  }

  const answers: AppAnswers = {};

  for (const key of ASSESSMENT_ITEM_KEYS) {
    const questionCode = ASSESSMENT_KEY_QUESTION_CODES[key];
    if (questionCode === null) continue; // แอปไม่ได้ถามข้อนี้ (motor_rigidity/motor_bradykinesia)

    const row = latestByQuestion.get(questionCode);
    if (!row) continue; // ยังไม่มีคำตอบในช่วงเวลานี้

    const answerText = describeAnswer(row.answer_value, row.skipped, row.question_bank.options_json);

    if (questionCode === DELAY_OR_SUBOPTIMAL_QUESTION_CODE) {
      const { delay, suboptimal } = delayOrSuboptimalFlags(row);
      const flagged = key === "mf_delay_on" ? delay : suboptimal;
      answers[key] = { answer: answerText, flagged, answered_at: row.answered_at };
      continue;
    }

    answers[key] = { answer: answerText, flagged: isFlagged(row), answered_at: row.answered_at };
  }

  return { window: { from: fromIso, to: toIso }, answers };
}
