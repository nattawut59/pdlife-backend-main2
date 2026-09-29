import { supabase } from "../config/supabaseClient";
import type { ClinicAssessmentRow } from "../types/database";

/**
 * ฟอร์มคัดกรองที่พยาบาลกรอกก่อนผู้ป่วยพบแพทย์ (ตาราง clinic_assessments)
 *
 * ตอนนี้มีแค่การอ่านเพื่อบอกสถานะบนตารางนัด ส่วนการบันทึกฟอร์มจริงเป็นงานถัดไป
 */

/**
 * ฟอร์มคัดกรองของหลายนัดในคำขอเดียว
 *
 * ตารางนัดวันหนึ่งมีหลายสิบคน ถ้าดึงทีละนัดจะกลายเป็นหลายสิบคำขอเหมือนหน้าทะเบียนตอนแรก
 * ที่เคยยิง 151 ครั้งจนหน้าค้าง
 */
export async function findByAppointmentIds(
  appointmentIds: string[]
): Promise<ClinicAssessmentRow[]> {
  // PostgREST ตีความ in.() ที่ว่างเปล่าไม่เหมือนกับ "ไม่มีอะไรตรง" — กันไว้ตั้งแต่ต้น
  if (appointmentIds.length === 0) return [];

  const { data, error } = await supabase
    .from("clinic_assessments")
    .select("*")
    .in("appointment_id", appointmentIds);
  if (error) throw error;
  return data ?? [];
}

export async function findByAppointmentId(
  appointmentId: string
): Promise<ClinicAssessmentRow | null> {
  const { data, error } = await supabase
    .from("clinic_assessments")
    .select("*")
    .eq("appointment_id", appointmentId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function insert(
  row: Record<string, unknown>
): Promise<ClinicAssessmentRow> {
  const { data, error } = await supabase
    .from("clinic_assessments")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function update(
  id: string,
  patch: Record<string, unknown>
): Promise<ClinicAssessmentRow> {
  const { data, error } = await supabase
    .from("clinic_assessments")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
