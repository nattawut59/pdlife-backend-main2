import { supabase } from "../config/supabaseClient";
import { dateOnly } from "../utils/datetime";
import type { AppointmentRow } from "../types/database";
import type { VisitStatus, VisitType } from "../config/constants";

export async function findById(id: string): Promise<AppointmentRow | null> {
  const { data, error } = await supabase.from("appointments").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/** C3 (FR): the most recent completed visit before a given date, to diff against. */
export async function findPreviousCompleted(
  patientId: string,
  beforeVisitDate: string
): Promise<AppointmentRow | null> {
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("patient_id", patientId)
    .eq("status", "completed")
    .lt("visit_date", beforeVisitDate)
    .order("visit_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Drives the EMA window (schema §9.1): daily/weekly/previsit rounds only fire within N days of a visit. */
export async function listUpcoming(withinDays: number, now = new Date()): Promise<AppointmentRow[]> {
  // visit_date เป็นคอลัมน์ DATE (วันตามปฏิทิน) จึงต้องเทียบกับวันที่ตามปฏิทินไทย ไม่ใช่ UTC —
  // ช่วงเที่ยงคืนถึงเจ็ดโมงเช้าเวลาไทย วันที่ UTC ยังเป็นเมื่อวาน ทำให้ช่วงค้นหาเลื่อนไปทั้งแถบ
  const until = new Date(now.getTime() + withinDays * 24 * 60 * 60_000);

  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .gte("visit_date", dateOnly(now))
    .lte("visit_date", dateOnly(until))
    .in("status", ["scheduled", "checked_in"])
    .order("visit_date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * นัดทั้งหมดของวันหนึ่ง เรียงตามเวลา
 *
 * ไม่กรองสถานะโดยตั้งใจ — หน้าจอคลินิกต้องเห็นทั้งคนที่ยังไม่มา คนที่ตรวจเสร็จแล้ว และคนที่
 * ไม่มาตามนัด อยู่ในตารางเดียวกัน การซ่อนคนที่ไม่มาทำให้ไม่มีใครรู้ว่าต้องตามใคร
 *
 * visit_time เป็น null ได้ (นัดที่ยังไม่ระบุเวลา) ให้ไปอยู่ท้ายตาราง ไม่ใช่หัวตาราง
 */
export async function listByDate(date: string): Promise<AppointmentRow[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("visit_date", date)
    .order("visit_time", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * วันที่ของนัดทุกใบในช่วงหนึ่ง — เอาไปนับต่อเป็นจำนวนต่อวัน
 *
 * ดึงมาแค่คอลัมน์เดียวแล้วนับฝั่งแอป ไม่ทำ GROUP BY ใน Postgres เพราะ PostgREST ต้องมี
 * database function มารองรับ ซึ่งแปลว่าต้องมี migration เพิ่ม — ไม่คุ้มกับข้อมูลระดับไม่กี่ร้อยแถว
 * (ช่วงสูงสุดที่ยอมให้ขอคือหนึ่งเดือน)
 *
 * ไม่กรองสถานะ ให้ตรงกับ listByDate ที่ตั้งใจไม่กรองเช่นกัน — ตัวเลขบนปฏิทินจะได้เท่ากับจำนวน
 * แถวที่เห็นจริงตอนกดเข้าไปดูวันนั้น ถ้ากรองต่างกันจะกลายเป็น "จุดบอกว่ามี 5 แต่เปิดมาเห็น 3"
 */
export async function listDatesInRange(from: string, to: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("visit_date")
    .gte("visit_date", from)
    .lte("visit_date", to);
  if (error) throw error;
  return (data ?? []).map((row) => row.visit_date);
}

export interface CreateAppointmentInput {
  patient_id: string;
  doctor_id: string | null;
  visit_date: string;
  visit_time: string | null;
  visit_type: VisitType;
  status: VisitStatus;
  created_by: string;
  created_appoint_name: string | null;
}

export async function create(input: CreateAppointmentInput): Promise<AppointmentRow> {
  const { data, error } = await supabase
    .from("appointments")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * มีนัดของคนนี้ในช่องเวลานี้อยู่แล้วไหม — ใช้กันการกดปุ่มซ้ำ (คนไข้คนเดียวกันได้นัดสองใบ
 * ทับกันโดยไม่ตั้งใจ) ส่วนกันคิวชนกันของหมอเป็นหน้าที่ของ findByDoctorAndSlot ด้านล่าง
 *
 * visit_time เป็น null ได้ (นัดที่ยังไม่ระบุเวลา) ต้องเทียบด้วย is null ไม่ใช่ eq null
 * เพราะใน SQL ค่า null ไม่เท่ากับ null
 */
export async function findByPatientAndSlot(
  patientId: string,
  visitDate: string,
  visitTime: string | null
): Promise<AppointmentRow | null> {
  let query = supabase
    .from("appointments")
    .select("*")
    .eq("patient_id", patientId)
    .eq("visit_date", visitDate);

  query = visitTime === null ? query.is("visit_time", null) : query.eq("visit_time", visitTime);

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * หมอคนนี้มีนัดอื่นในช่วงเวลานี้แล้วหรือยัง — เช็คก่อนเขียนเพื่อข้อความ error ที่เป็นมิตร
 * ด่านที่รับประกันจริงคือ unique index ใน migrations/0005_one_appointment_per_doctor_slot.sql
 * (อ่านก่อนเขียนมีช่องว่างเสมอเมื่อสองคำขอมาพร้อมกัน — เหตุผลเดียวกับ findByPatientAndSlot)
 *
 * ไม่นับนัดที่ถูกยกเลิกแล้ว (status = cancelled) — ช่วงเวลาที่ถูกปล่อยคืนต้องว่างให้จองใหม่ได้
 * ตรงกับเงื่อนไข WHERE ของ unique index ใน migration ด้านบน
 */
export async function findByDoctorAndSlot(
  doctorId: string,
  visitDate: string,
  visitTime: string
): Promise<AppointmentRow | null> {
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("doctor_id", doctorId)
    .eq("visit_date", visitDate)
    .eq("visit_time", visitTime)
    .neq("status", "cancelled")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** เวลาที่หมอคนนี้จองไปแล้ววันนี้ (ไม่นับที่ยกเลิก) — ใช้คำนวณ slot ว่างสำหรับ available-slots */
export async function listByDoctorAndDate(doctorId: string, visitDate: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("visit_time")
    .eq("doctor_id", doctorId)
    .eq("visit_date", visitDate)
    .neq("status", "cancelled")
    .not("visit_time", "is", null);
  if (error) throw error;
  // คอลัมน์เป็น TIME ในฐานข้อมูล — PostgREST คืนเป็น "HH:MM:SS" เสมอ ต้องตัดวินาทีทิ้งให้ตรง
  // รูปแบบเดียวกับ generateSlotGrid() ("HH:MM") ไม่งั้นเทียบกันไม่ตรงเลยสักช่อง (เหมือน
  // timeLabel() ฝั่งเว็บที่ทำ .slice(0,5) ด้วยเหตุผลเดียวกัน)
  return (data ?? []).map((row) => (row.visit_time as string).slice(0, 5));
}

export async function updateStatus(id: string, status: VisitStatus): Promise<AppointmentRow | null> {
  const { data, error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * นัดที่ผ่านมาแล้ว เรียงล่าสุดก่อน — ใช้ทำรายการ "บันทึกที่ผ่านมา"
 *
 * รวมนัดที่ยกเลิกด้วยโดยตั้งใจ ต่างจากรายการงานประจำวันที่กรองทิ้ง — ถ้าพยาบาลกรอกฟอร์ม
 * ลงนัดที่ยกเลิกไปแล้ว (เช่นตอนมีนัดซ้ำแล้วยกเลิกผิดใบ) ฟอร์มนั้นจะเข้าถึงไม่ได้เลยถ้าไม่
 * แสดงที่นี่ ข้อมูลทางคลินิกที่เปิดดูไม่ได้ก็เท่ากับไม่มี
 */
export async function listBefore(date: string, limit: number): Promise<AppointmentRow[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .lt("visit_date", date)
    .order("visit_date", { ascending: false })
    .order("visit_time", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * ทุกครั้งที่ผู้ป่วยรายนี้มาตรวจ เรียงล่าสุดก่อน — ใช้ในแท็บของเวชระเบียนรายคน
 *
 * ส่ง `from` มา = มุมมอง "นัดที่จะถึง" กรองตั้งแต่วันนั้นเป็นต้นไปและ**เรียงกลับเป็นใกล้สุดก่อน**
 * เพราะการไล่นัดอนาคตต้องอ่านจากวันที่ใกล้ที่สุดไปไกล ตรงข้ามกับการไล่ประวัติ
 */
export async function listByPatient(
  patientId: string,
  limit: number,
  from?: string,
  to?: string,
  date?: string
): Promise<AppointmentRow[]> {
  const ascending = from !== undefined || date !== undefined;

  let query = supabase.from("appointments").select("*").eq("patient_id", patientId);
  if (from !== undefined) query = query.gte("visit_date", from);
  if (to !== undefined) query = query.lte("visit_date", to);
  if (date !== undefined) query = query.eq("visit_date", date);

  const { data, error } = await query
    .order("visit_date", { ascending })
    .order("visit_time", { ascending, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
