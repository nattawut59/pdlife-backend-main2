import { supabase } from "../config/supabaseClient";
import type { DeviceRow, UserRow } from "../types/database";

/**
 * ข้อมูลสำหรับหน้า "ผู้ใช้จากแอป"
 *
 * ยิง query คงที่ 3 ครั้งไม่ว่าจะมีผู้ใช้กี่คน แล้วจัดกลุ่มในหน่วยความจำ — แบบเดียวกับ
 * dashboardRepository.getRoster ด้วยเหตุผลเดียวกัน คือหน้าเดียวไม่ควรยิงคำขอต่อผู้ใช้หนึ่งคน
 */

export type AppUserRow = Pick<
  UserRow,
  "id" | "first_name" | "last_name" | "role" | "phone_number"
>;

/** ผู้ใช้ที่เป็นเจ้าของแอป — เจ้าหน้าที่คลินิกใช้เว็บ ไม่นับอยู่ในนี้ */
export async function listAppUsers(): Promise<AppUserRow[]> {
  const { data, error } = await supabase
    .from("users")
    .select("id, first_name, last_name, role, phone_number")
    .in("role", ["patient", "caregiver"])
    .eq("is_active", true)
    .order("first_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AppUserRow[];
}

export type DeviceInfo = Pick<
  DeviceRow,
  "user_id" | "platform" | "app_version" | "push_enabled" | "last_seen_at"
>;

/**
 * อุปกรณ์ของผู้ใช้หลายคนในคำขอเดียว
 *
 * ไม่กรอง push_enabled ออก ต่างจาก listActiveByUser ที่ใช้ตอนส่งแจ้งเตือน — หน้านี้ต้องเห็น
 * คนที่ปิดแจ้งเตือนไว้ด้วย เพราะนั่นคือสาเหตุหนึ่งที่ผู้ป่วยไม่ได้บันทึกอาการ
 */
export async function listDevicesForUsers(userIds: string[]): Promise<DeviceInfo[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await supabase
    .from("devices")
    .select("user_id, platform, app_version, push_enabled, last_seen_at")
    .in("user_id", userIds)
    .order("last_seen_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DeviceInfo[];
}

/**
 * เวลาบันทึกอาการของผู้ป่วยหลายคน
 *
 * ไม่มีขอบบนของช่วงเวลาโดยตั้งใจ — answered_at ประทับด้วยนาฬิกาของฐานข้อมูล ถ้าเทียบกับ
 * เวลาจากเครื่องแอป คำตอบที่เพิ่งบันทึกจะดูเหมือนอยู่ในอนาคตแล้วหายไป (ดู WindowEnd ใน
 * dashboardRepository)
 *
 * คืนเฉพาะ patient_id กับ answered_at แล้วไปนับ/หาค่าสูงสุดในชั้น service เพราะ PostgREST
 * ทำ group by ให้ไม่ได้ตรง ๆ และจำนวนแถวระดับคลินิกเดียวยังเล็กพอที่จะนับในหน่วยความจำ
 */
export async function listResponseActivity(
  patientIds: string[],
  fromIso: string
): Promise<Array<{ patient_id: string; answered_at: string }>> {
  if (patientIds.length === 0) return [];
  const { data, error } = await supabase
    .from("responses")
    .select("patient_id, answered_at")
    .in("patient_id", patientIds)
    .gte("answered_at", fromIso);
  if (error) throw error;
  return (data ?? []) as Array<{ patient_id: string; answered_at: string }>;
}

/** คำตอบล่าสุดของผู้ป่วยแต่ละคน ไม่จำกัดช่วงเวลา — ใช้ตอบว่า "บันทึกครั้งสุดท้ายเมื่อไหร่" */
export async function listLatestResponseAt(
  patientIds: string[]
): Promise<Array<{ patient_id: string; answered_at: string }>> {
  if (patientIds.length === 0) return [];
  const { data, error } = await supabase
    .from("responses")
    .select("patient_id, answered_at")
    .in("patient_id", patientIds)
    .order("answered_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Array<{ patient_id: string; answered_at: string }>;
}
