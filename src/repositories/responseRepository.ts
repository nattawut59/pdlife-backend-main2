import { supabase } from "../config/supabaseClient";
import type { AnswerValue, QuestionBankRow, ResponseRow } from "../types/database";
import type { RespondentRole } from "../config/constants";

export async function listByRound(roundInstanceId: string): Promise<ResponseRow[]> {
  const { data, error } = await supabase
    .from("responses")
    .select("*")
    .eq("round_instance_id", roundInstanceId);
  if (error) throw error;
  return data ?? [];
}

/** One database request for progress on a list of rounds. */
export async function listByRounds(roundIds: string[]): Promise<ResponseRow[]> {
  if (roundIds.length === 0) return [];
  const { data, error } = await supabase
    .from("responses")
    .select("round_instance_id,question_code,answer_value,skipped")
    .in("round_instance_id", roundIds);
  if (error) throw error;
  return (data ?? []) as ResponseRow[];
}

export interface UpsertResponseInput {
  patient_id: string;
  round_instance_id: string;
  question_code: string;
  question_version: number;
  answer_value: AnswerValue;
  skipped: boolean;
  answered_by_role: RespondentRole;
}

export interface ResponseWithQuestion extends ResponseRow {
  question_bank: QuestionBankRow;
}

/**
 * คำตอบของผู้ป่วยต่อชุดคำถามที่ระบุ ภายในช่วงเวลา พร้อมข้อมูลคำถาม (options_json,
 * red_flag_json) — ใช้ทำตารางเทียบ "แอป vs พยาบาล" (appAssessmentService)
 *
 * เรียงจากใหม่ไปเก่า — ผู้เรียกต้องเลือกเอาแถวแรกสุดต่อ question_code เอง (คำตอบล่าสุด)
 * เพราะ responses ไม่มี UNIQUE(patient_id, question_code) ผู้ป่วยตอบคำถามเดิมซ้ำได้ทุกรอบ
 */
export async function listLatestForQuestions(
  patientId: string,
  questionCodes: string[],
  fromIso: string
): Promise<ResponseWithQuestion[]> {
  const { data, error } = await supabase
    .from("responses")
    .select("*, question_bank(*)")
    .eq("patient_id", patientId)
    .in("question_code", questionCodes)
    .gte("answered_at", fromIso)
    .order("answered_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ResponseWithQuestion[];
}

/** UNIQUE(round_instance_id, question_code) — re-answering the same question in a round overwrites it. */
export async function upsertResponse(input: UpsertResponseInput): Promise<ResponseRow> {
  const { data, error } = await supabase
    .from("responses")
    .upsert(input, { onConflict: "round_instance_id,question_code" })
    .select()
    .single();
  if (error) throw error;
  return data;
}
