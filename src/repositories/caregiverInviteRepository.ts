import { supabase } from "../config/supabaseClient";
import type { CaregiverInviteRow } from "../types/database";

export interface CreateInviteInput {
  patient_id: string;
  code: string;
  created_by: string;
  expires_at: string;
}

export async function createInvite(input: CreateInviteInput): Promise<CaregiverInviteRow> {
  const { data, error } = await supabase
    .from("caregiver_invites")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** รหัสที่ยัง "ใช้งานได้จริง" ตอนนี้เท่านั้น — ยังไม่ redeem และยังไม่หมดอายุ */
export async function findActiveByCode(code: string): Promise<CaregiverInviteRow | null> {
  const { data, error } = await supabase
    .from("caregiver_invites")
    .select("*")
    .eq("code", code)
    .is("redeemed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * ทำเครื่องหมายว่า redeem แล้ว แบบ conditional บน "ยังไม่เคย redeem มาก่อน" ในตัว query เอง
 * (ไม่ใช่เช็คแยกแล้วค่อย update) กันสอง request แข่งกัน redeem รหัสเดียวกันพร้อมกัน — ถ้าอีก
 * request หนึ่งชนะไปก่อน แถวที่ update ได้จะเป็น 0 แถว ทำให้ฟังก์ชันนี้คืน null ให้ผู้เรียกรู้ว่าแพ้แข่ง
 */
export async function markRedeemed(
  id: string,
  redeemedBy: string
): Promise<CaregiverInviteRow | null> {
  const { data, error } = await supabase
    .from("caregiver_invites")
    .update({ redeemed_at: new Date().toISOString(), redeemed_by: redeemedBy })
    .eq("id", id)
    .is("redeemed_at", null)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}
