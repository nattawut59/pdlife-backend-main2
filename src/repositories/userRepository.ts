import { supabase } from "../config/supabaseClient";
import type { UserRow } from "../types/database";
import type { UserRole } from "../config/constants";

export async function findUserByUsername(userName: string): Promise<UserRow | null> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("user_name", userName)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { data, error } = await supabase.from("users").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * ค้นด้วย auth.users.id ของ Supabase — เส้นทางสำหรับผู้ใช้ที่ล็อกอินผ่าน Supabase Auth
 * คืน null ได้ในกรณีที่มีบัญชีใน Supabase แล้วแต่ยังไม่มีโปรไฟล์ใน PDLIFE
 */
export async function findUserByAuthUid(authUid: string): Promise<UserRow | null> {
  const { data, error } = await supabase.from("users").select("*").eq("auth_uid", authUid).maybeSingle();
  if (error) throw error;
  return data;
}

export interface CreateUserInput {
  first_name: string;
  last_name: string;
  user_name: string;
  // ผู้ใช้ที่ล็อกอินผ่าน Supabase Auth ไม่มี password_hash — รหัสผ่านอยู่ฝั่ง Supabase
  password_hash?: string;
  auth_uid?: string;
  role: UserRow["role"];
  phone_number?: string;
  preferred_language?: UserRow["preferred_language"];
}

export async function createUser(input: CreateUserInput): Promise<UserRow> {
  const { data, error } = await supabase.from("users").insert(input).select().single();
  if (error) throw error;
  return data;
}

/**
 * ใช้ตอน rollback เท่านั้น (เช่น สร้าง caregiver_profiles ไม่สำเร็จหลัง users row สร้างไปแล้ว)
 * ตารางลูกที่มี FK ชี้มาที่ users แบบ ON DELETE CASCADE (เช่น caregiver_profiles) จะถูกลบตามไปด้วย
 */
export async function deleteUser(id: string): Promise<void> {
  const { error } = await supabase.from("users").delete().eq("id", id);
  if (error) throw error;
}

export async function touchLastLogin(id: string): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function updateUserName(
  id: string,
  patch: { first_name: string; last_name: string }
): Promise<UserRow> {
  const { data, error } = await supabase
    .from("users")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMyPreferences(
  id: string,
  patch: Pick<UserRow, "preferred_language">
): Promise<UserRow> {
  const { data, error } = await supabase.from("users").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

/**
 * ผู้ใช้หลายคนในคำขอเดียว — ใช้แปลง doctor_id บนตารางนัดเป็นชื่อแพทย์
 *
 * คืน UserRow เต็มรวม password_hash ตามชนิดของตาราง คนเรียกต้องหยิบเฉพาะฟิลด์ที่จะแสดง
 * ห้ามส่งทั้งแถวออกไปทาง API
 */
/**
 * ผู้ดูแลที่ใช้เบอร์นี้ — เบอร์ต้องถูก normalize เป็น `+66...` มาก่อน (ดู phoneField)
 *
 * จำกัด role เป็น caregiver ในตัว query เอง ไม่ใช่ให้ผู้เรียกกรองทีหลัง เพื่อไม่ให้ endpoint
 * ค้นเบอร์กลายเป็นช่องทางเช็คว่าเบอร์ไหนเป็นของผู้ป่วยหรือบุคลากรในระบบ
 */
export async function findCaregiverByPhone(phone: string): Promise<UserRow | null> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("phone_number", phone)
    .eq("role", "caregiver")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findUsersByIds(ids: string[]): Promise<UserRow[]> {
  if (ids.length === 0) return [];

  const { data, error } = await supabase.from("users").select("*").in("id", ids);
  if (error) throw error;
  return data ?? [];
}

/**
 * ผู้ใช้ทั้งหมดที่มีบทบาทหนึ่ง — ใช้ทำรายการแพทย์ให้เลือกตอนสร้างนัด
 *
 * เอาเฉพาะบัญชีที่ยังใช้งานอยู่ คนที่ลาออกไปแล้วไม่ควรโผล่ในช่องเลือกแพทย์ผู้ตรวจ
 */
export async function listByRole(role: UserRole): Promise<UserRow[]> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("role", role)
    .eq("is_active", true)
    .order("first_name");
  if (error) throw error;
  return data ?? [];
}
