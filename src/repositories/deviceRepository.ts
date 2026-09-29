import { supabase } from "../config/supabaseClient";
import type { DeviceRow } from "../types/database";

export async function listActiveByUser(userId: string): Promise<DeviceRow[]> {
  const { data, error } = await supabase
    .from("devices")
    .select("*")
    .eq("user_id", userId)
    .eq("push_enabled", true);
  if (error) throw error;
  return data ?? [];
}

export interface RegisterDeviceInput {
  user_id: string;
  expo_push_token: string;
  platform: DeviceRow["platform"];
  app_version?: string;
}

export async function registerDevice(input: RegisterDeviceInput): Promise<DeviceRow> {
  const { data, error } = await supabase
    .from("devices")
    .upsert(
      { ...input, last_seen_at: new Date().toISOString(), push_enabled: true },
      { onConflict: "expo_push_token" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setPushEnabled(
  id: string,
  userId: string,
  pushEnabled: boolean
): Promise<DeviceRow> {
  const { data, error } = await supabase
    .from("devices")
    .update({ push_enabled: pushEnabled, last_seen_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
