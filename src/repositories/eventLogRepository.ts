import { supabase } from "../config/supabaseClient";
import type { EventType, OnOffState, Severity } from "../config/constants";
import type { EventLogRow } from "../types/database";

export interface CreateEventLogInput {
  patient_id: string;
  recorded_by: string | null;
  event_type: EventType;
  severity: Severity;
  injury_occurred: boolean;
  required_er: boolean;
  on_off_time?: OnOffState;
  occurred_at: string;
  note?: string;
}

export async function createEventLog(input: CreateEventLogInput): Promise<EventLogRow> {
  const { data, error } = await supabase.from("event_logs").insert(input).select().single();
  if (error) throw error;
  return data;
}

/** ทุก severity เรียงล่าสุดก่อน — สำหรับหน้าเวชระเบียน ต่างจาก dashboardRepository.getSevereEventLogs ที่กรองเฉพาะ severe/critical สำหรับนับ warning */
export async function listByPatient(patientId: string): Promise<EventLogRow[]> {
  const { data, error } = await supabase
    .from("event_logs")
    .select("*")
    .eq("patient_id", patientId)
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
