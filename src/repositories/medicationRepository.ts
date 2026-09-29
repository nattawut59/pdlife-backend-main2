import { supabase } from "../config/supabaseClient";
import type { MedicationRow } from "../types/database";

export async function listMedications(): Promise<MedicationRow[]> {
  const { data, error } = await supabase
    .from("medications")
    .select("*")
    .order("drug_name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * ยาหลายตัวในคำขอเดียว — ใช้ตอน scheduler ประกอบข้อความแจ้งเตือนให้ทั้งรอบ
 *
 * ห้ามยิงทีละโดส: หนึ่ง tick มีได้หลายสิบโดสและหลายโดสก็เป็นยาตัวเดียวกัน การ query ต่อโดส
 * จะทำให้จำนวนคำขอโตตามจำนวนผู้ป่วย ซึ่งเป็นสิ่งที่ REMINDER_DISPATCH_CONCURRENCY พยายามกันอยู่
 */
export async function findMedicationsByIds(ids: string[]): Promise<MedicationRow[]> {
  if (ids.length === 0) return [];

  const { data, error } = await supabase.from("medications").select("*").in("id", ids);
  if (error) throw error;
  return data ?? [];
}

export async function findMedicationById(id: string): Promise<MedicationRow | null> {
  const { data, error } = await supabase
    .from("medications")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface CreateMedicationInput {
  id: string;
  drug_name: string;
  drug_generic_name?: string;
  drug_thai_name?: string;
  medication_class?: string;
  drug_form?: string;
  strength?: string;
  drug_quantity?: string;
  dosage_instructions?: string;
  side_effects?: string;
  contraindications?: string;
  interactions?: string;
  ledd_factor?: number;
}

export async function createMedication(input: CreateMedicationInput): Promise<MedicationRow> {
  const { data, error } = await supabase.from("medications").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateMedication(
  id: string,
  patch: Partial<Omit<CreateMedicationInput, "id">> & { status?: MedicationRow["status"] }
): Promise<MedicationRow> {
  const { data, error } = await supabase
    .from("medications")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
