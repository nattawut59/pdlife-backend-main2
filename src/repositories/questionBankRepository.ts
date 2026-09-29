import { supabase } from "../config/supabaseClient";
import type { CheckinTemplateRow, QuestionBankRow, TemplateQuestionRow } from "../types/database";

/** ทุกคำถามในคลัง เรียงตาม domain_code แล้ว item_no — ใช้ทำหน้าอ้างอิง "คลังคำถาม" ของ staff */
export async function listAll(): Promise<QuestionBankRow[]> {
  const { data, error } = await supabase
    .from("question_bank")
    .select("*")
    .order("domain_code", { ascending: true })
    .order("item_no", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

/** ทุกรอบเช็คอิน (7 รอบ) — ใช้แสดงชื่อรอบให้หน้าอ้างอิง ไม่ใช่ตอนคำนวณ schedule จริง */
export async function listAllTemplates(): Promise<CheckinTemplateRow[]> {
  const { data, error } = await supabase.from("checkin_templates").select("*");
  if (error) throw error;
  return data ?? [];
}

/** ทุกการจับคู่คำถาม↔รอบ — คำถามหนึ่งอยู่ได้หลายรอบ ใช้ประกอบว่าคำถามไหนอยู่รอบไหนบ้าง */
export async function listAllTemplateQuestions(): Promise<TemplateQuestionRow[]> {
  const { data, error } = await supabase.from("template_questions").select("*");
  if (error) throw error;
  return data ?? [];
}

export async function findQuestionByCode(code: string): Promise<QuestionBankRow | null> {
  const { data, error } = await supabase
    .from("question_bank")
    .select("*")
    .eq("question_code", code)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findTemplate(templateCode: string): Promise<CheckinTemplateRow | null> {
  const { data, error } = await supabase
    .from("checkin_templates")
    .select("*")
    .eq("template_code", templateCode)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export type TemplateQuestionWithBank = TemplateQuestionRow & { question_bank: QuestionBankRow };

/** Ordered by sort_order — template_questions is the single source of truth for what's asked when (schema §3). */
export async function listTemplateQuestions(
  templateCode: string
): Promise<TemplateQuestionWithBank[]> {
  const { data, error } = await supabase
    .from("template_questions")
    .select("*, question_bank(*)")
    .eq("template_code", templateCode)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as TemplateQuestionWithBank[];
}

/** Loads distinct templates for list-page progress in one request. */
export async function listTemplateQuestionsForCodes(
  templateCodes: string[]
): Promise<TemplateQuestionWithBank[]> {
  if (templateCodes.length === 0) return [];
  const { data, error } = await supabase
    .from("template_questions")
    .select("*, question_bank(*)")
    .in("template_code", templateCodes);
  if (error) throw error;
  return (data ?? []) as unknown as TemplateQuestionWithBank[];
}
