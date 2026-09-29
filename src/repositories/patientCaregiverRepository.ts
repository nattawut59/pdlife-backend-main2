import { supabase } from "../config/supabaseClient";
import type { PatientCaregiverRow } from "../types/database";

export async function findActiveLink(
  patientId: string,
  caregiverId: string
): Promise<PatientCaregiverRow | null> {
  const { data, error } = await supabase
    .from("patient_caregivers")
    .select("*")
    .eq("patient_id", patientId)
    .eq("caregiver_id", caregiverId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findLinkById(id: string): Promise<PatientCaregiverRow | null> {
  const { data, error } = await supabase
    .from("patient_caregivers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface CreateCaregiverLinkInput {
  patient_id: string;
  caregiver_id: string;
  relationship?: string;
  can_answer?: boolean;
  is_primary?: boolean;
}

export async function createLink(input: CreateCaregiverLinkInput): Promise<PatientCaregiverRow> {
  const { data, error } = await supabase
    .from("patient_caregivers")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateLink(
  id: string,
  patch: Partial<Pick<PatientCaregiverRow, "relationship" | "can_answer" | "is_primary" | "active">>
): Promise<PatientCaregiverRow> {
  const { data, error } = await supabase
    .from("patient_caregivers")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listByPatient(patientId: string): Promise<PatientCaregiverRow[]> {
  const { data, error } = await supabase
    .from("patient_caregivers")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listByCaregiver(caregiverId: string): Promise<PatientCaregiverRow[]> {
  const { data, error } = await supabase
    .from("patient_caregivers")
    .select("*")
    .eq("caregiver_id", caregiverId)
    .eq("active", true)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** ผู้ดูแลหลักของผู้ป่วยหลายคนพร้อมกัน — ใช้ทำชื่อผู้ดูแลในทะเบียนผู้ป่วย (roster) แบบ batch */
export async function listPrimaryForPatients(
  patientIds: string[]
): Promise<Pick<PatientCaregiverRow, "patient_id" | "caregiver_id">[]> {
  if (patientIds.length === 0) return [];
  const { data, error } = await supabase
    .from("patient_caregivers")
    .select("patient_id, caregiver_id")
    .in("patient_id", patientIds)
    .eq("is_primary", true)
    .eq("active", true);
  if (error) throw error;
  return data ?? [];
}
