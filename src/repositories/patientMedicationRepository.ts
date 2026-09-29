import { supabase } from "../config/supabaseClient";
import type { PatientMedicationRow } from "../types/database";

export async function findPrescriptionById(id: string): Promise<PatientMedicationRow | null> {
  const { data, error } = await supabase
    .from("patient_medications")
    .select("*")
    .eq("prescription_id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findPrescriptionsByIds(ids: string[]): Promise<PatientMedicationRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("patient_medications")
    .select("*")
    .in("prescription_id", ids);
  if (error) throw error;
  return data ?? [];
}

/** System-wide active prescriptions — the scheduler's driver list for medication reminders (§9.6, always on). */
export async function listAllActive(): Promise<PatientMedicationRow[]> {
  const { data, error } = await supabase.from("patient_medications").select("*").eq("active", true);
  if (error) throw error;
  return data ?? [];
}

export async function listByPatient(
  patientId: string,
  activeOnly = true
): Promise<PatientMedicationRow[]> {
  let query = supabase
    .from("patient_medications")
    .select("*")
    .eq("patient_id", patientId)
    .order("start_date", { ascending: false });
  if (activeOnly) query = query.eq("active", true);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export interface CreatePrescriptionInput {
  patient_id: string;
  prescribed_by: string;
  prescribed_by_name: string;
  visit_id?: string;
  medication_id: string;
  scheduled_times: string[];
  doses: Record<string, string>;
  frequency?: string;
  special_instructions?: string;
  start_date: string;
  end_date?: string;
  previous_prescription_id?: string;
}

export async function createPrescription(
  input: CreatePrescriptionInput
): Promise<PatientMedicationRow> {
  const { data, error } = await supabase
    .from("patient_medications")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePrescription(
  id: string,
  patch: Partial<
    Pick<
      PatientMedicationRow,
      "scheduled_times" | "doses" | "frequency" | "special_instructions" | "end_date" | "active"
    >
  >
): Promise<PatientMedicationRow> {
  const { data, error } = await supabase
    .from("patient_medications")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("prescription_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
