import { supabase } from "../config/supabaseClient";
import type { AuditLogRow } from "../types/database";
import type { ListAuditLogsQuery } from "../schemas/auditLogSchema";

/** ดึงประวัติ audit_logs ตาม filter ที่ส่งมา เรียงใหม่ไปเก่าเสมอ — query อย่างเดียว ไม่มี logic */
export async function list(filters: ListAuditLogsQuery): Promise<AuditLogRow[]> {
  let query = supabase.from("audit_logs").select("*").order("created_at", { ascending: false });

  if (filters.target_table) query = query.eq("target_table", filters.target_table);
  if (filters.user_id) query = query.eq("user_id", filters.user_id);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.before) query = query.lt("created_at", filters.before);

  const { data, error } = await query.limit(filters.limit);
  if (error) throw error;
  return data ?? [];
}
