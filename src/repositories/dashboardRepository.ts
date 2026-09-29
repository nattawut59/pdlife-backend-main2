import { supabase } from "../config/supabaseClient";
import type { EventLogRow, MedicationLogRow, OnOffTimelineRow, ResponseRow } from "../types/database";

/**
 * ขอบบนของช่วงเวลา — `null` แปลว่า "ถึงปัจจุบัน" และจะไม่ใส่เงื่อนไขขอบบนเลย
 *
 * ทุกคอลัมน์เวลาที่กรองในไฟล์นี้ (ts / answered_at / occurred_at / planned_at) ถูกประทับด้วย
 * DEFAULT now() ของ Postgres คือใช้ "นาฬิกาของฐานข้อมูล" แต่ค่าที่เราส่งไปเทียบคำนวณจาก
 * "นาฬิกาของเครื่องที่รันแอป" ซึ่งไม่มีทางตรงกันเป๊ะ
 *
 * ถ้านาฬิกาฐานข้อมูลเร็วกว่าแม้แต่วินาทีเดียว แถวที่เพิ่งถูกเขียนจะดู "อยู่ในอนาคต" แล้วโดน
 * ขอบบนกรองทิ้ง — และแถวที่โดนซ่อนคือแถวใหม่ที่สุดเสมอ ซึ่งเป็นแถวที่สำคัญที่สุดพอดี
 * เคยเจอจริงตอนนาฬิกาเครื่องช้ากว่าฐานข้อมูล 90 วินาที: ผู้ป่วยตอบแล้วหมอไม่เห็นบน dashboard
 *
 * คำถามที่ dashboard ถามคือ "ช่วงที่ผ่านมาเกิดอะไรขึ้น" ซึ่งไม่ต้องการขอบบนอยู่แล้ว เพราะ
 * ข้อมูลจากอนาคตไม่มีอยู่จริง — ส่วนช่วงเวลาในอดีตจริง ๆ (เทียบก่อน/หลังวันนัด) ยังส่งค่ามาได้
 */
export type WindowEnd = string | null;

/** ใส่เงื่อนไขขอบบนเฉพาะเมื่อช่วงเวลามีจุดจบจริง — ดูเหตุผลที่ WindowEnd */
function upTo<T extends { lte: (column: string, value: string) => T }>(
  query: T,
  column: string,
  toIso: WindowEnd
): T {
  return toIso === null ? query : query.lte(column, toIso);
}

/** v_onoff_timeline (schema §8.1) — the Hauser diary graph, C2. */
export async function getOnOffTimeline(
  patientId: string,
  fromIso: string,
  toIso: WindowEnd
): Promise<OnOffTimelineRow[]> {
  const { data, error } = await upTo(
    supabase.from("v_onoff_timeline").select("*").eq("patient_id", patientId).gte("ts", fromIso),
    "ts",
    toIso
  ).order("ts", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => {
    // POST_MED_MICRO is now one question. Preserve the view's legacy shape so
    // every graph/summary keeps working alongside older three-question rounds.
    if (row.state !== "state_dyskinesia") return row;
    return { ...row, dyskinesia: row.dyskinesia ?? "yes" };
  });
}

export async function getResponsesForQuestions(
  patientId: string,
  questionCodes: string[],
  fromIso: string,
  toIso: WindowEnd
): Promise<ResponseRow[]> {
  const { data, error } = await upTo(
    supabase
      .from("responses")
      .select("*")
      .eq("patient_id", patientId)
      .in("question_code", questionCodes)
      .gte("answered_at", fromIso),
    "answered_at",
    toIso
  );
  if (error) throw error;
  return data ?? [];
}

export async function getSevereEventLogs(
  patientId: string,
  fromIso: string,
  toIso: WindowEnd
): Promise<EventLogRow[]> {
  const { data, error } = await upTo(
    supabase
      .from("event_logs")
      .select("*")
      .eq("patient_id", patientId)
      .in("severity", ["severe", "critical"])
      .gte("occurred_at", fromIso),
    "occurred_at",
    toIso
  );
  if (error) throw error;
  return data ?? [];
}

export async function getLateMedicationLogs(
  patientId: string,
  fromIso: string,
  toIso: WindowEnd,
  lateThresholdMinutes: number
): Promise<MedicationLogRow[]> {
  const { data, error } = await upTo(
    supabase.from("medication_logs").select("*").eq("patient_id", patientId).gte("planned_at", fromIso),
    "planned_at",
    toIso
  ).gt("late_minutes", lateThresholdMinutes);
  if (error) throw error;
  return data ?? [];
}

export interface AdherenceCounts {
  taken: number;
  skipped: number;
  total: number;
}

/** medication_logs.status is the system-recorded source of truth for adherence — more direct
 *  than the patient's self-reported MED_ADHERENCE diary answer, which reflects timing, not
 *  whether the dose was actually taken. */
export async function getAdherenceCounts(
  patientId: string,
  fromIso: string,
  toIso: WindowEnd
): Promise<AdherenceCounts> {
  const { data, error } = await upTo(
    supabase.from("medication_logs").select("status").eq("patient_id", patientId).gte("planned_at", fromIso),
    "planned_at",
    toIso
  ).in("status", ["taken", "skipped"]);
  if (error) throw error;

  const rows = data ?? [];
  const taken = rows.filter((r) => r.status === "taken").length;
  return { taken, skipped: rows.length - taken, total: rows.length };
}

// ---------- roster: ดึงทีเดียวสำหรับผู้ป่วยหลายคน ----------
//
// หน้าทะเบียนผู้ป่วยเคยเรียก endpoint รายคน 3 ตัวต่อผู้ป่วยหนึ่งคน — ผู้ป่วย 50 คนกลายเป็น
// 151 คำขอต่อการเปิดหน้าหนึ่งครั้ง ฟังก์ชันกลุ่มนี้ยิง query ละครั้งครอบคลุมผู้ป่วยทุกคน
// แล้วค่อยไปจัดกลุ่มในหน่วยความจำ จำนวน query จึงคงที่ไม่ว่าจะมีผู้ป่วยกี่คน
//
// ตั้งใจไม่ย้ายการคำนวณลง SQL — ตัวเลขทุกตัวยังคำนวณด้วยฟังก์ชันบริสุทธิ์ชุดเดิมใน
// dashboardService ที่มีเทสต์ครอบอยู่แล้ว หน้าทะเบียนกับหน้าเวชระเบียนจึงไม่มีทางให้
// ตัวเลขไม่ตรงกัน ซึ่งเป็นสิ่งที่หมอจับได้ทันทีและทำให้เลิกเชื่อทั้งระบบ

/** จัดแถวเข้ากลุ่มตาม patient_id — คืน Map ที่ทุก id ที่ขอมามีคีย์เสมอ (ไม่มีข้อมูล = array ว่าง) */
export function groupByPatient<T extends { patient_id: string }>(
  rows: T[],
  patientIds: string[]
): Map<string, T[]> {
  const map = new Map<string, T[]>(patientIds.map((id) => [id, []]));
  for (const row of rows) map.get(row.patient_id)?.push(row);
  return map;
}

export async function getOnOffTimelineForPatients(
  patientIds: string[],
  fromIso: string
): Promise<OnOffTimelineRow[]> {
  if (patientIds.length === 0) return [];
  const { data, error } = await supabase
    .from("v_onoff_timeline")
    .select("*")
    .in("patient_id", patientIds)
    .gte("ts", fromIso)
    .order("ts", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getResponsesForPatients(
  patientIds: string[],
  questionCodes: string[],
  fromIso: string
): Promise<ResponseRow[]> {
  if (patientIds.length === 0) return [];
  const { data, error } = await supabase
    .from("responses")
    .select("*")
    .in("patient_id", patientIds)
    .in("question_code", questionCodes)
    .gte("answered_at", fromIso);
  if (error) throw error;
  return data ?? [];
}

export async function getSevereEventLogsForPatients(
  patientIds: string[],
  fromIso: string
): Promise<EventLogRow[]> {
  if (patientIds.length === 0) return [];
  const { data, error } = await supabase
    .from("event_logs")
    .select("*")
    .in("patient_id", patientIds)
    .in("severity", ["severe", "critical"])
    .gte("occurred_at", fromIso);
  if (error) throw error;
  return data ?? [];
}

/** ทั้งการนับกินยาตรงเวลาและการนับกินยาสายใช้ตารางเดียวกัน จึงดึงรอบเดียวแล้วแยกทีหลัง */
export async function getMedicationLogsForPatients(
  patientIds: string[],
  fromIso: string
): Promise<MedicationLogRow[]> {
  if (patientIds.length === 0) return [];
  const { data, error } = await supabase
    .from("medication_logs")
    .select("*")
    .in("patient_id", patientIds)
    .gte("planned_at", fromIso);
  if (error) throw error;
  return data ?? [];
}
