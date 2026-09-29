import { supabase } from "../config/supabaseClient";
import type { NotificationRow } from "../types/database";
import type { DeliveryStatus, NotifTrigger, NotifType } from "../config/constants";

export interface CreateNotificationInput {
  user_id: string;
  patient_id: string;
  device_id?: string;
  round_instance_id?: string;
  prescription_id?: string;
  medication_log_id?: string;
  appointment_id?: string;
  type: NotifType;
  trigger_type?: NotifTrigger;
  questions_remaining?: number;
  delivery_status?: DeliveryStatus;
}

export async function createNotification(input: CreateNotificationInput): Promise<NotificationRow> {
  const { data, error } = await supabase.from("notifications").insert(input).select().single();
  if (error) throw error;
  return data;
}

/** กัน cron สร้างแจ้งเตือนนัดชนิดเดิมซ้ำทุกนาที */
export async function existsForAppointmentAndType(
  appointmentId: string,
  type: NotifType,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("appointment_id", appointmentId)
    .eq("type", type);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function markDelivery(id: string, status: DeliveryStatus): Promise<void> {
  const patch: Record<string, unknown> = { delivery_status: status };
  if (status === "sent") patch.sent_at = new Date().toISOString();

  const { error } = await supabase.from("notifications").update(patch).eq("id", id);
  if (error) throw error;
}

export interface ListNotificationsOptions {
  unreadOnly?: boolean;
  limit?: number;
}

/**
 * รายการแจ้งเตือนของผู้รับคนหนึ่ง — เรียงใหม่สุดก่อน
 *
 * กรอง user_id เสมอไม่ว่าผู้เรียกจะเป็นใคร เพราะตารางนี้เก็บของทุกคนรวมกัน และ `user_id` คือ
 * "ใครเป็นผู้รับ" ไม่ใช่ "เรื่องของผู้ป่วยคนไหน" (นั่นคือ patient_id) — ผู้ดูแลจึงเห็นเฉพาะ
 * แจ้งเตือนที่ระบบยิงถึงตัวเอง ไม่ใช่ของผู้ป่วยที่ผูกไว้ทั้งหมด
 *
 * unreadOnly ตรงกับ index idx_notif_unread (user_id, is_read) WHERE NOT is_read ที่มีอยู่แล้ว
 */
export async function listForUser(
  userId: string,
  options: ListNotificationsOptions = {}
): Promise<NotificationRow[]> {
  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("triggered_at", { ascending: false });

  if (options.unreadOnly) query = query.eq("is_read", false);
  if (options.limit !== undefined) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function setReadStateForIds(ids: string[], userId: string, isRead: boolean): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: isRead })
    .eq("user_id", userId)
    .in("id", ids);
  if (error) throw error;
}

export async function markAllRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false);
  if (error) throw error;
}

export async function deleteManyForUser(ids: string[], userId: string): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from("notifications").delete().eq("user_id", userId).in("id", ids);
  if (error) throw error;
}
