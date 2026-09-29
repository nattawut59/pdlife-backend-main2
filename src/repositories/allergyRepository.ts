import { supabase } from "../config/supabaseClient";
import type { PatientAllergyRow } from "../types/database";

export async function listByPatient(patientId: string): Promise<PatientAllergyRow[]> {
  const { data, error } = await supabase
    .from("patient_allergies")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function create(input: Pick<PatientAllergyRow, "patient_id" | "substance" | "created_by">): Promise<PatientAllergyRow> {
  const { data, error } = await supabase.from("patient_allergies").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function findById(id: string): Promise<PatientAllergyRow | null> {
  const { data, error } = await supabase.from("patient_allergies").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function remove(id: string): Promise<void> {
  const { error } = await supabase.from("patient_allergies").delete().eq("id", id);
  if (error) throw error;
}
