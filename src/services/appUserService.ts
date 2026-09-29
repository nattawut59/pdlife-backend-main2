import { ApiError } from "../utils/ApiError";
import type { JwtPayload } from "../utils/jwt";
import {
  listAppUsers,
  listDevicesForUsers,
  listLatestResponseAt,
  listResponseActivity,
} from "../repositories/appUserRepository";
import { findCaregiverByPhone, listByRole, updateMyPreferences as updatePreferences } from "../repositories/userRepository";
import type { DeviceRow } from "../types/database";
import type { UserRole } from "../config/constants";

/**
 * ใครใช้แอปอยู่จริง — คนละคำถามกับ "ใครเป็นคนไข้ที่นี่"
 *
 * รวมผู้ดูแลที่ไม่ได้เป็นคนไข้ และรวมคนที่ยังไม่เคยเปิดแอปเลย เพราะคำถามที่พยาบาลถามจริงคือ
 * "ใครหายไปจากระบบและควรโทรตาม" ซึ่งคนที่ไม่เคยเปิดแอปเลยคือคำตอบอันดับหนึ่ง
 */

/** ช่วงที่ใช้นับการบันทึกอาการ — ตรงกับที่หน้าเว็บเขียนว่า "7 วัน" */
const ACTIVITY_DAYS = 7;

const STAFF_ROLES: ReadonlySet<string> = new Set(["nurse", "doctor", "admin"]);

export interface AppUserView {
  id: string;
  first_name: string;
  last_name: string;
  role: "patient" | "caregiver";
  phone_number: string | null;
  /** null = ยังไม่เคยลงทะเบียนอุปกรณ์ = ยังไม่เคยเปิดแอป */
  platform: DeviceRow["platform"] | null;
  app_version: string | null;
  push_enabled: boolean | null;
  /**
   * เวลาบันทึกอาการครั้งล่าสุด
   *
   * null สำหรับผู้ดูแลเสมอ ไม่ใช่เพราะไม่มีข้อมูล แต่เพราะ responses เก็บแค่ answered_by_role
   * ว่าเป็น "ผู้ดูแล" ไม่ได้เก็บว่าเป็นผู้ดูแลคนไหน จึงระบุตัวไม่ได้
   */
  last_response_at: string | null;
  /** จำนวนคำตอบใน 7 วันล่าสุด — null สำหรับผู้ดูแล ด้วยเหตุผลเดียวกับข้างบน */
  responses_7d: number | null;
}

export async function listAppUserActivity(
  requester: JwtPayload
): Promise<{ window_days: number; users: AppUserView[] }> {
  if (!STAFF_ROLES.has(requester.role)) {
    throw new ApiError(403, "Only clinic staff can read the app user list");
  }

  const users = await listAppUsers();
  const ids = users.map((u) => u.id);
  const patientIds = users.filter((u) => u.role === "patient").map((u) => u.id);

  const from = new Date();
  from.setUTCDate(from.getUTCDate() - ACTIVITY_DAYS);

  const [devices, recent, latest] = await Promise.all([
    listDevicesForUsers(ids),
    listResponseActivity(patientIds, from.toISOString()),
    listLatestResponseAt(patientIds),
  ]);

  // อุปกรณ์เรียงจากที่เห็นล่าสุดมาก่อนแล้ว — ตัวแรกที่เจอของแต่ละคนคืออุปกรณ์ที่ใช้อยู่จริง
  const deviceOf = new Map<string, (typeof devices)[number]>();
  for (const d of devices) if (!deviceOf.has(d.user_id)) deviceOf.set(d.user_id, d);

  const countOf = new Map<string, number>();
  for (const r of recent) countOf.set(r.patient_id, (countOf.get(r.patient_id) ?? 0) + 1);

  // เรียงจากใหม่ไปเก่ามาแล้ว ตัวแรกของแต่ละคนคือคำตอบล่าสุด
  const latestOf = new Map<string, string>();
  for (const r of latest) if (!latestOf.has(r.patient_id)) latestOf.set(r.patient_id, r.answered_at);

  return {
    window_days: ACTIVITY_DAYS,
    users: users.map((u) => {
      const d = deviceOf.get(u.id);
      const isPatient = u.role === "patient";
      return {
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        role: u.role as "patient" | "caregiver",
        phone_number: u.phone_number,
        platform: d?.platform ?? null,
        app_version: d?.app_version ?? null,
        push_enabled: d?.push_enabled ?? null,
        last_response_at: isPatient ? (latestOf.get(u.id) ?? null) : null,
        responses_7d: isPatient ? (countOf.get(u.id) ?? 0) : null,
      };
    }),
  };
}

/** ชื่อบุคลากรสำหรับช่องเลือกบนหน้าจอ — ไม่มีเบอร์โทรหรือข้อมูลบัญชี */
export interface StaffOption {
  id: string;
  first_name: string;
  last_name: string;
  role: UserRole;
}

/**
 * ค้นผู้ดูแลจากเบอร์โทร — ผู้ป่วยต้องรู้ `caregiver_id` (UUID) ก่อนถึงจะผูกผู้ดูแลได้ แต่สิ่งเดียว
 * ที่ผู้ป่วยรู้จริงคือเบอร์โทรของลูกหลาน จึงต้องมีทางแปลงเบอร์เป็น id
 *
 * ⚠️ นี่คือการค้น "เบอร์ → ตัวตน" ซึ่งอ่อนไหวโดยธรรมชาติ จึงจำกัดไว้สามชั้น:
 *   1. ค้นได้เฉพาะบัญชี role=caregiver ที่ยัง active (ผู้ป่วย/บุคลากรค้นไม่เจอ)
 *   2. ต้องตรงทั้งเบอร์เท่านั้น ไม่มีค้นบางส่วน จะได้ไล่เดาเป็นชุดไม่ได้
 *   3. คืนแค่ id กับชื่อ ไม่สะท้อนเบอร์กลับไป และมี rate limit ที่ route
 *
 * ชื่อที่คืนไปมีไว้ให้ผู้ป่วยยืนยันว่าใช่คนที่ตั้งใจก่อนกดผูกจริง — ถ้าไม่คืนชื่อเลย ผู้ป่วยจะผูก
 * ผู้ดูแลผิดคนโดยไม่มีทางรู้ ซึ่งอันตรายกว่าเพราะผู้ดูแลเห็นข้อมูลอาการทั้งหมด
 */
export async function lookupCaregiverByPhone(phone: string): Promise<StaffOption> {
  const user = await findCaregiverByPhone(phone);
  if (!user) throw new ApiError(404, "No caregiver account is registered with this phone number");

  return { id: user.id, first_name: user.first_name, last_name: user.last_name, role: user.role };
}

export async function listStaffByRole(role: UserRole): Promise<StaffOption[]> {
  const users = await listByRole(role);
  return users.map((u) => ({
    id: u.id,
    first_name: u.first_name,
    last_name: u.last_name,
    role: u.role,
  }));
}

export async function updateMyPreferences(userId: string, preferredLanguage: "th" | "en") {
  const user = await updatePreferences(userId, { preferred_language: preferredLanguage });
  const { password_hash: _passwordHash, ...safeUser } = user;
  return safeUser;
}
