import { supabase } from "../config/supabaseClient";
import type { QuestionBankRow, RedFlagRow, ResponseRow } from "../types/database";
import type { FlagSeverity } from "../config/constants";

export interface CreateRedFlagInput {
  patient_id: string;
  response_id?: string;
  event_log_id?: string;
  question_code?: string;
  clinic_tag: string;
  severity: FlagSeverity;
}

export async function createRedFlag(input: CreateRedFlagInput): Promise<RedFlagRow> {
  const { data, error } = await supabase.from("red_flags").insert(input).select().single();
  if (error) throw error;
  return data;
}

/**
 * ธงของผู้ป่วยหนึ่งคนในช่วงเวลาที่กำหนด พร้อมคำถามและคำตอบที่ทำให้ธงนี้เกิด
 *
 * ดึงคำถาม/คำตอบมาด้วยในคำสั่งเดียว เพราะแถวใน red_flags บอกแค่ว่า "ยิงธงเพราะอะไร"
 * (clinic_tag) แต่ไม่ได้บอกว่าผู้ป่วยตอบว่าอะไร — ซึ่งต่างกันมากในทางคลินิก เช่น
 * "มีบ้างเป็นบางครั้ง" กับ "เคยคิดวางแผน" ยิงธง suicidal_ideation เหมือนกันทั้งคู่
 */
export interface RedFlagWithContext extends RedFlagRow {
  responses: Pick<ResponseRow, "answer_value" | "answered_at" | "skipped"> | null;
  question_bank: Pick<QuestionBankRow, "question_full_th" | "options_json"> | null;
}

/**
 * ไม่มีขอบบนของช่วงเวลาโดยตั้งใจ — red_flags.created_at ประทับด้วยนาฬิกาของฐานข้อมูล
 * แต่ถ้าเทียบกับเวลาที่คำนวณจากเครื่องแอป ธงที่เพิ่งยิงจะดูเหมือนอยู่ในอนาคตแล้วหายไป
 * (เจอจริงตอนนาฬิกาเหลื่อมกัน 90 วินาที — ดูคำอธิบายเต็มที่ WindowEnd ใน dashboardRepository)
 *
 * สำหรับธงระดับ urgent การซ่อนแถวใหม่ที่สุดคือการซ่อนแถวที่สำคัญที่สุด
 */
export async function listRedFlagsForPatient(
  patientId: string,
  fromIso: string,
  onlyUnreviewed = false
): Promise<RedFlagWithContext[]> {
  let query = supabase
    .from("red_flags")
    .select(
      "*, responses(answer_value, answered_at, skipped), question_bank(question_full_th, options_json)"
    )
    .eq("patient_id", patientId)
    .gte("created_at", fromIso);

  if (onlyUnreviewed) query = query.eq("reviewed", false);

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as RedFlagWithContext[];
}

/** ธงที่ยังไม่มีใครรับทราบของผู้ป่วยหลายคน — สำหรับหน้าทะเบียน ไม่ต้องมีคำถาม/คำตอบ */
export async function countUnreviewedFlagsForPatients(
  patientIds: string[],
  fromIso: string
): Promise<Pick<RedFlagRow, "patient_id" | "severity">[]> {
  if (patientIds.length === 0) return [];
  const { data, error } = await supabase
    .from("red_flags")
    .select("patient_id, severity")
    .in("patient_id", patientIds)
    .eq("reviewed", false)
    .gte("created_at", fromIso);
  if (error) throw error;
  return data ?? [];
}

export async function findRedFlagById(id: string): Promise<RedFlagRow | null> {
  const { data, error } = await supabase.from("red_flags").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * ตั้งสถานะรับทราบ
 *
 * ส่ง "now" ให้ Postgres ตีความเป็นเวลาปัจจุบัน **ของฐานข้อมูล** ไม่ใช่ส่งเวลาจากเครื่องแอป
 * เพราะ created_at ถูกประทับด้วยนาฬิกาของฐานข้อมูล ถ้าสองฝั่งเหลื่อมกันแล้วพยาบาลกด
 * รับทราบทันที จะได้ reviewed_at ที่อยู่ "ก่อน" created_at — หน้าจอจะอ่านว่ารับทราบเสร็จ
 * ตั้งแต่ก่อนธงจะเกิด ซึ่งทำให้คนเลิกเชื่อเวลาบนหน้าจอทั้งหมด
 *
 * ยกเลิกได้ (reviewed = false) เพราะไม่มีทางอื่นให้แก้เวลากดผิด และการปล่อยให้ธงที่
 * ยังไม่ได้จัดการถูกปิดถาวรอันตรายกว่าการยอมให้เปิดกลับ
 */
export async function setRedFlagReviewed(
  id: string,
  reviewerId: string,
  reviewed: boolean
): Promise<RedFlagRow> {
  const patch = reviewed
    ? { reviewed: true, reviewed_by: reviewerId, reviewed_at: "now" }
    : { reviewed: false, reviewed_by: null, reviewed_at: null };

  const { data, error } = await supabase
    .from("red_flags")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
