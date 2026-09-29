import { supabase } from "../config/supabaseClient";
import type { CaregiverProfileRow } from "../types/database";

export interface CreateCaregiverProfileInput {
  user_id: string;
  prefix: string;
  gender: CaregiverProfileRow["gender"];
  date_of_birth: string;
  relationship: string;
  address_line: string;
  subdistrict: string;
  district: string;
  province: string;
  postal_code: string;
}

export async function createProfile(
  input: CreateCaregiverProfileInput
): Promise<CaregiverProfileRow> {
  const { data, error } = await supabase.from("caregiver_profiles").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function findProfileByUserId(userId: string): Promise<CaregiverProfileRow | null> {
  const { data, error } = await supabase
    .from("caregiver_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
