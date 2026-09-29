import { supabase } from "../config/supabaseClient";
import type { RoundInstanceRow } from "../types/database";
import { dateOnly } from "../utils/datetime";

export async function findRoundById(id: string): Promise<RoundInstanceRow | null> {
  const { data, error } = await supabase
    .from("round_instances")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface ListRoundsOptions {
  status?: RoundInstanceRow["status"];
  activityDate?: string;
  actionableAt?: string;
  limit?: number;
}

export async function listByPatient(
  patientId: string,
  options: ListRoundsOptions = {}
): Promise<RoundInstanceRow[]> {
  let query = supabase
    .from("round_instances")
    .select("*")
    .eq("patient_id", patientId)
    .order("scheduled_at", { ascending: false })
    .limit(options.limit ?? (options.activityDate || options.actionableAt ? 1000 : 50));
  if (options.status) query = query.eq("status", options.status);
  if (options.activityDate) query = query.eq("activity_date", options.activityDate);
  if (options.actionableAt) {
    query = query
      .lte("available_at", options.actionableAt)
      .or(`expires_at.is.null,expires_at.gt.${options.actionableAt}`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export interface CreateRoundInput {
  patient_id: string;
  template_code: string;
  prescription_id?: string;
  target_dose_at?: string;
  medication_log_id?: string;
  appointment_id?: string;
  scheduled_at: string;
  activity_date?: string;
  available_at?: string;
  due_at?: string;
  idempotency_key?: string;
  expires_at?: string;
}

export async function createRound(input: CreateRoundInput): Promise<RoundInstanceRow> {
  const normalized = {
    ...input,
    activity_date: input.activity_date ?? dateOnly(new Date(input.scheduled_at)),
    available_at: input.available_at ?? input.scheduled_at,
  };
  const { data, error } = await supabase.from("round_instances").insert(normalized).select().single();
  if (error) throw error;
  return data;
}

/** Atomic scheduler insert. null means another process won the same idempotency key. */
export async function createRoundIfAbsent(input: CreateRoundInput): Promise<RoundInstanceRow | null> {
  if (!input.idempotency_key) throw new Error("Scheduler rounds require idempotency_key");
  const normalized = {
    ...input,
    activity_date: input.activity_date ?? dateOnly(new Date(input.scheduled_at)),
    available_at: input.available_at ?? input.scheduled_at,
  };
  const { data, error } = await supabase
    .from("round_instances")
    .upsert(normalized, { onConflict: "idempotency_key", ignoreDuplicates: true })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Round-level offline sync (schema §1.1) — submitted_at is the client's local clock, received_at the server's. */
export async function touchSync(id: string, submittedAt?: string): Promise<RoundInstanceRow> {
  const patch: Record<string, string> = { received_at: new Date().toISOString() };
  if (submittedAt) patch.submitted_at = submittedAt;

  const { data, error } = await supabase
    .from("round_instances")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markCompleted(id: string, answeredBy: string): Promise<RoundInstanceRow> {
  const { data, error } = await supabase
    .from("round_instances")
    .update({ status: "completed", completed_at: new Date().toISOString(), answered_by: answeredBy })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markExpired(id: string): Promise<RoundInstanceRow> {
  const { data, error } = await supabase
    .from("round_instances")
    .update({ status: "expired" })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markMissed(id: string): Promise<RoundInstanceRow> {
  const { data, error } = await supabase
    .from("round_instances")
    .update({ status: "missed" })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Every pending round past its window — driver list for the sweep job. */
export async function listStalePending(limit = 200): Promise<RoundInstanceRow[]> {
  const { data, error } = await supabase
    .from("round_instances")
    .select("*")
    .eq("status", "pending")
    .not("expires_at", "is", null)
    .lt("expires_at", new Date().toISOString())
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
