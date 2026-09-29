import { supabase } from "../config/supabaseClient";
import type { PatientFullRow, PatientProfileRow } from "../types/database";

export async function findProfileByUserId(userId: string): Promise<PatientProfileRow | null> {
  const { data, error } = await supabase
    .from("patient_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findManyByUserIds(userIds: string[]): Promise<PatientProfileRow[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await supabase.from("patient_profiles").select("*").in("user_id", userIds);
  if (error) throw error;
  return data ?? [];
}

/** v_patient_full (schema §8.2) — patient + profile in one row, no joins needed by callers. */
export async function findPatientFull(userId: string): Promise<PatientFullRow | null> {
  const { data, error } = await supabase
    .from("v_patient_full")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * ค้นผู้ป่วยด้วยเลขบัตรประชาชน/HN — ใช้ .eq() แยกคอลัมน์ (ไม่ใช่ .or() string-interpolate)
 * เพื่อไม่ต้อง escape ค่า identifier เองเลย ป้องกัน PostgREST filter injection โดยธรรมชาติ —
 * ดู caregiverService.ts::findPatientByIdentifier ว่าเลือกเรียกอันไหนตามรูปแบบ
 */
export async function findPatientFullByIdCard(idCard: string): Promise<PatientFullRow | null> {
  const { data, error } = await supabase
    .from("v_patient_full")
    .select("*")
    .eq("id_card_number", idCard)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findPatientFullByHn(hn: string): Promise<PatientFullRow | null> {
  const { data, error } = await supabase
    .from("v_patient_full")
    .select("*")
    .eq("hn_number", hn)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface CreatePatientProfileInput {
  user_id: string;
  id_card_number?: string;
  hn_number?: string;
  gender?: PatientProfileRow["gender"];
  date_of_birth: string;
  diagnosis_date?: string;
  diagnosis?: PatientProfileRow["diagnosis"];
  other_diagnosis?: string;
  hoehn_yahr_stage?: number;
  wake_time: string;
  sleep_time: string;
  province?: string;
}

export async function createProfile(
  input: CreatePatientProfileInput
): Promise<PatientProfileRow> {
  const { data, error } = await supabase.from("patient_profiles").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateProfile(
  userId: string,
  patch: Partial<Omit<CreatePatientProfileInput, "user_id">>
): Promise<PatientProfileRow> {
  const { data, error } = await supabase
    .from("patient_profiles")
    .update(patch)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export interface ListPatientsOptions {
  limit?: number;
  offset?: number;
}

export async function listPatients(options: ListPatientsOptions = {}): Promise<PatientFullRow[]> {
  const { limit = 50, offset = 0 } = options;
  const { data, error } = await supabase
    .from("v_patient_full")
    .select("*")
    .order("registered_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data ?? [];
}

/**
 * จำนวนผู้ป่วยทั้งหมดในระบบ — ใช้บอกว่ารายการที่ส่งไปถูกตัดหรือยัง
 *
 * `head: true` แปลว่าไม่ดึงแถวเลย เอามาแต่ตัวเลขนับ จึงถูกกว่าการดึงทั้งตารางมานับเอง
 * มีไว้เพราะหน้าจอที่ขึ้นว่า "ผู้ป่วยในความดูแล 50 ราย" ทั้งที่จริงมี 120 คนคือตัวเลขที่หลอกคนอ่าน
 * โดยไม่มีอะไรบอกใบ้เลย
 */
export async function countPatients(): Promise<number> {
  const { count, error } = await supabase
    .from("v_patient_full")
    .select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

/**
 * ข้อมูลผู้ป่วยหลายคนในคำขอเดียว จาก view เดียวกับที่หน้าทะเบียนใช้
 *
 * ใช้ view เดิมไม่ใช่ query ใหม่ เพื่อให้ชื่อ HN และอายุที่โผล่บนตารางนัด ตรงกับที่โผล่บนหน้า
 * ทะเบียนเสมอ — ผู้ป่วยคนเดียวกันต้องไม่แสดงอายุไม่ตรงกันคนละหน้า
 */
export async function findPatientFullByIds(userIds: string[]): Promise<PatientFullRow[]> {
  if (userIds.length === 0) return [];

  const { data, error } = await supabase.from("v_patient_full").select("*").in("id", userIds);
  if (error) throw error;
  return data ?? [];
}
