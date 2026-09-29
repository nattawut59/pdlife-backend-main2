import { supabase } from "../config/supabaseClient";
import type { DoctorNoteRow } from "../types/database";

/**
 * บันทึกผลการตรวจของแพทย์ (ตาราง doctor_notes)
 *
 * ตอนนี้มีแค่การอ่านเพื่อบอกว่านัดนั้นบันทึกแล้วหรือยัง ส่วนการบันทึกจริงเป็นงานถัดไป
 */
export async function findByAppointmentIds(appointmentIds: string[]): Promise<DoctorNoteRow[]> {
  if (appointmentIds.length === 0) return [];

  const { data, error } = await supabase
    .from("doctor_notes")
    .select("*")
    .in("appointment_id", appointmentIds);
  if (error) throw error;
  return data ?? [];
}

export async function findByAppointmentId(appointmentId: string): Promise<DoctorNoteRow | null> {
  const { data, error } = await supabase
    .from("doctor_notes")
    .select("*")
    .eq("appointment_id", appointmentId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function insert(row: Record<string, unknown>): Promise<DoctorNoteRow> {
  const { data, error } = await supabase
    .from("doctor_notes")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function update(
  id: string,
  patch: Record<string, unknown>
): Promise<DoctorNoteRow> {
  const { data, error } = await supabase
    .from("doctor_notes")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
