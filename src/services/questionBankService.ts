import * as questionBankRepository from "../repositories/questionBankRepository";
import { MOOD_SUICIDAL_QUESTION_CODE } from "./redFlagService";
import { STRUCTURED_RULE_OVERRIDES } from "../config/constants";
import type { MvpPhase, RespondentPolicy } from "../config/constants";
import type {
  CheckinTemplateRow,
  QuestionBankRow,
  QuestionOption,
  TemplateQuestionRow,
} from "../types/database";

/**
 * เปิดใช้ "คลังคำถาม" ให้ staff เห็นภาพรวมได้ — อ่านอย่างเดียว ไม่มี endpoint แก้ไข เพราะ
 * xlsx (docs/PDLIFE_Question_Bank_master_v1.xlsx) เป็นแหล่งข้อมูลจริงหนึ่งเดียวอยู่แล้ว
 * (seed/gen_seed.py) — ถ้าแก้ผ่านเว็บด้วยจะมีสองแหล่งที่ขัดกันเอง
 */

export type RuleStatus = "no_rule" | "warning_only" | "enforced" | "safety_gate" | "not_enforced";

/**
 * สถานะกฎ red flag ของคำถามหนึ่ง — ต่อยอดจาก STRUCTURED_RULE_OVERRIDES ที่เพิ่งสร้างวันนี้
 * (redFlagService.ts) เพื่อให้เห็นได้จากหน้าจอตรงๆ ว่าข้อไหนยิงจริง ไม่ต้องเปิดโค้ดอ่าน
 *
 * ลำดับการเช็คสำคัญ: MOOD_SUICIDAL_IDEATION ต้องเช็คก่อนเสมอ เพราะมันไม่ผ่าน
 * checkStructuredRedFlagRule เลย (ยิงผ่าน checkMoodSafetyGate แยกต่างหาก) ต่อให้
 * red_flag_json ของมันหน้าตาเป็นยังไงก็ตาม
 */
export function classifyRuleStatus(question: QuestionBankRow): RuleStatus {
  if (question.question_code === MOOD_SUICIDAL_QUESTION_CODE) return "safety_gate";

  const rule = question.red_flag_json;
  if (rule.severity === "warning") return "warning_only";
  if (rule.severity !== "red" && rule.severity !== "urgent") return "no_rule";

  const hasStructuredRule = typeof rule.rule === "object" && rule.rule !== null;
  if (hasStructuredRule || STRUCTURED_RULE_OVERRIDES[question.question_code]) return "enforced";
  return "not_enforced";
}

export interface QuestionBankEntry {
  question_code: string;
  qid: string | null;
  item_no: number | null;
  domain_code: string;
  domain_name_th: string | null;
  question_full_th: string;
  answer_type: string;
  options_json: QuestionOption[];
  respondent: RespondentPolicy;
  mvp_phase: MvpPhase | null;
  active: boolean;
  rule_status: RuleStatus;
  /** รอบเช็คอินที่ใช้คำถามนี้ — คำถามหนึ่งอยู่ได้หลายรอบ (template_questions) */
  template_codes: string[];
}

/**
 * ประกอบคำถามกับรอบที่มันอยู่ — แยกออกจากส่วนคุย DB เพื่อเทสได้โดยไม่ต้องต่อฐานข้อมูล
 * เหมือน assembleAppointments/assembleAuditLogs
 */
export function assembleQuestionBank(
  questions: QuestionBankRow[],
  templateQuestions: TemplateQuestionRow[]
): QuestionBankEntry[] {
  const templatesByQuestion = new Map<string, string[]>();
  for (const tq of templateQuestions) {
    const list = templatesByQuestion.get(tq.question_code) ?? [];
    list.push(tq.template_code);
    templatesByQuestion.set(tq.question_code, list);
  }

  return questions.map((q) => ({
    question_code: q.question_code,
    qid: q.qid,
    item_no: q.item_no,
    domain_code: q.domain_code,
    domain_name_th: q.domain_name_th,
    question_full_th: q.question_full_th,
    answer_type: q.answer_type,
    options_json: q.options_json,
    respondent: q.respondent,
    mvp_phase: q.mvp_phase,
    active: q.active,
    rule_status: classifyRuleStatus(q),
    template_codes: templatesByQuestion.get(q.question_code) ?? [],
  }));
}

export async function list(): Promise<{
  questions: QuestionBankEntry[];
  templates: CheckinTemplateRow[];
}> {
  const [questions, templates, templateQuestions] = await Promise.all([
    questionBankRepository.listAll(),
    questionBankRepository.listAllTemplates(),
    questionBankRepository.listAllTemplateQuestions(),
  ]);

  return { questions: assembleQuestionBank(questions, templateQuestions), templates };
}
