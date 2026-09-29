import { supabase } from "../config/supabaseClient";
import type { MedicationLogRow } from "../types/database";

export async function findLogById(id: string): Promise<MedicationLogRow | null> {
  const { data, error } = await supabase
    .from("medication_logs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listByPatient(patientId: string, limit = 50): Promise<MedicationLogRow[]> {
  const { data, error } = await supabase
    .from("medication_logs")
    .select("*")
    .eq("patient_id", patientId)
    .order("planned_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function listByPatientAndActivityDate(
  patientId: string,
  activityDate: string
): Promise<MedicationLogRow[]> {
  const { data, error } = await supabase
    .from("medication_logs")
    .select("*")
    .eq("patient_id", patientId)
    .eq("activity_date", activityDate)
    .order("planned_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listByPatientInRange(
  patientId: string,
  fromIso: string,
  toIso: string
): Promise<MedicationLogRow[]> {
  const { data, error } = await supabase
    .from("medication_logs")
    .select("*")
    .eq("patient_id", patientId)
    .gte("planned_at", fromIso)
    .lt("planned_at", toIso)
    .order("planned_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function updateLogStatus(
  id: string,
  patch: Partial<Pick<MedicationLogRow, "status" | "taken_at" | "dose_taken" | "note" | "submitted_at">>
): Promise<MedicationLogRow> {
  const { data, error } = await supabase
    .from("medication_logs")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export interface CreatePendingLogInput {
  patient_id: string;
  prescription_id: string;
  planned_at: string;
  activity_date: string;
  idempotency_key: string;
}

/** Atomic scheduler insert. null means another process already created this exact dose. */
export async function createPendingLogIfAbsent(
  input: CreatePendingLogInput
): Promise<MedicationLogRow | null> {
  const { data, error } = await supabase
    .from("medication_logs")
    .upsert(input, { onConflict: "idempotency_key", ignoreDuplicates: true })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Broad net for the POST_MED_MICRO generator. The medication schedule is the
 * source of truth, so this deliberately does not filter by status/taken_at.
 * Precise 30/60-minute windowing happens per row in the scheduler service.
 */
export async function findRecentlyPlanned(maxAgeMinutes: number, now = new Date()): Promise<MedicationLogRow[]> {
  const since = new Date(now.getTime() - maxAgeMinutes * 60_000).toISOString();
  const { data, error } = await supabase
    .from("medication_logs")
    .select("*")
    .gte("planned_at", since)
    .lte("planned_at", now.toISOString());
  if (error) throw error;
  return data ?? [];
}

/**
 * Pending logs older than cutoff -> auto-skip. The schema doesn't define an explicit
 * medication_logs expiry window (unlike round_instances.expires_at); the scheduler uses a
 * fixed grace period documented in schedulerService.ts rather than guessing a per-dose one.
 */
