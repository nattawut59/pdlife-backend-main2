import { supabase } from "../config/supabaseClient";
import type { ConsentRow } from "../types/database";

export async function latestAccepted(userId: string, consentType: string): Promise<ConsentRow | null> {
  const { data, error } = await supabase
    .from("consents")
    .select("*")
    .eq("user_id", userId)
    .eq("consent_type", consentType)
    .eq("accepted", true)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function create(input: Pick<ConsentRow, "user_id" | "consent_type" | "version" | "accepted" | "ip_address">): Promise<ConsentRow> {
  const { data, error } = await supabase.from("consents").insert(input).select().single();
  if (error) throw error;
  return data;
}
