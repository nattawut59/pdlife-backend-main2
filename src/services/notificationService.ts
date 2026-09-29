import { listActiveByUser } from "../repositories/deviceRepository";
import { listByPatient as listCaregiverLinksByPatient } from "../repositories/patientCaregiverRepository";
import {
  createNotification,
  listForUser,
  markDelivery,
  markAllRead,
  deleteManyForUser,
  setReadStateForIds,
  type ListNotificationsOptions,
} from "../repositories/notificationRepository";
import { ApiError } from "../utils/ApiError";
import type { DeviceRow, NotificationRow } from "../types/database";
import type { NotifTrigger, NotifType } from "../config/constants";
import { findPatientFullByIds } from "../repositories/patientProfileRepository";
import { findPrescriptionsByIds } from "../repositories/patientMedicationRepository";
import { findMedicationsByIds } from "../repositories/medicationRepository";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const ANDROID_NOTIFICATION_CHANNEL_ID = "pdlife-reminders";

export function buildExpoPushMessage(
  device: Pick<DeviceRow, "expo_push_token">,
  params: Pick<NotifyParams, "title" | "body" | "data">
) {
  return {
    to: device.expo_push_token,
    title: params.title,
    body: params.body,
    sound: "default" as const,
    priority: "high" as const,
    channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
    ...(params.data ? { data: params.data } : {}),
  };
}

/** Patient's own devices + active, answer-permitted, primary caregiver's devices (FR P6 caregiver mode). */
async function getRecipients(patientId: string): Promise<{ userIds: string[]; devices: DeviceRow[] }> {
  const [ownDevices, links] = await Promise.all([
    listActiveByUser(patientId),
    listCaregiverLinksByPatient(patientId),
  ]);

  const primaryCaregiverIds = links
    .filter((l) => l.active && l.is_primary && l.can_answer)
    .map((l) => l.caregiver_id);

  const caregiverDeviceLists = await Promise.all(primaryCaregiverIds.map((id) => listActiveByUser(id)));
  return {
    userIds: [patientId, ...primaryCaregiverIds],
    devices: [...ownDevices, ...caregiverDeviceLists.flat()],
  };
}

export interface NotifyParams {
  patientId: string;
  type: NotifType;
  triggerType?: NotifTrigger;
  title: string;
  body: string;
  roundInstanceId?: string;
  prescriptionId?: string;
  medicationLogId?: string;
  appointmentId?: string;
  questionsRemaining?: number;
  /**
   * payload ที่แนบไปกับ push — แอปใช้เปิดหน้าที่ถูกต้องตอนผู้ใช้กดแจ้งเตือน
   *
   * ไม่มีก็ยิงได้ปกติ (แจ้งเตือนที่ไม่ต้องพาไปไหนไม่ต้องใส่) แต่ถ้าไม่ใส่ แอปจะรู้แค่ข้อความ
   * แล้วต้องไล่หาเองว่าหมายถึงมื้อไหนของใบสั่งยาไหน ซึ่งเป็นการ query 3 ตารางจากฝั่งเครื่อง
   * ผู้ใช้เพื่อข้อมูลที่เรารู้อยู่แล้วตอนสร้างแจ้งเตือน
   */
  data?: Record<string, unknown>;
}

/**
 * Writes one notifications row per recipient device (schema §5: log every notification, not
 * just successful ones), then attempts a real Expo push send. Expo's push API needs no
 * credentials for anonymous sends against valid ExponentPushToken[...] tokens, so this works
 * with no extra env config — it will correctly report "failed" against non-Expo-format tokens.
 */
export async function notify(params: NotifyParams): Promise<void> {
  const { userIds, devices } = await getRecipients(params.patientId);

  // กล่องแจ้งเตือนต้องทำงานแม้ผู้ใช้ปฏิเสธ push permission จึงสร้างแถว fallback
  // ไม่มี device ให้ผู้ป่วยเสมอ ส่วนผู้ดูแลที่มีอุปกรณ์จะได้แถวตามอุปกรณ์เหมือนเดิม
  const targets: Array<{ userId: string; device: DeviceRow | null }> = devices.map((device) => ({
    userId: device.user_id,
    device,
  }));
  for (const userId of userIds) {
    if (!targets.some((target) => target.userId === userId)) {
      targets.push({ userId, device: null });
    }
  }

  const notificationRows = await Promise.all(
    targets.map(({ userId, device }) =>
      createNotification({
        user_id: userId,
        patient_id: params.patientId,
        ...(device ? { device_id: device.id } : {}),
        round_instance_id: params.roundInstanceId,
        prescription_id: params.prescriptionId,
        medication_log_id: params.medicationLogId,
        appointment_id: params.appointmentId,
        type: params.type,
        trigger_type: params.triggerType ?? "system",
        questions_remaining: params.questionsRemaining,
        delivery_status: device ? "queued" : "sent",
      })
    )
  );

  const pushTargets = targets.filter((target): target is { userId: string; device: DeviceRow } => target.device !== null);
  if (pushTargets.length === 0) return;

  const messages = pushTargets.map(({ device }) => buildExpoPushMessage(device, params));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    const json = (await res.json()) as { data?: Array<{ status: string }> };
    const tickets = json.data ?? [];

    await Promise.all(
      notificationRows
        .filter((row) => row.device_id !== null)
        .map((row, i) => markDelivery(row.id, tickets[i]?.status === "ok" ? "sent" : "failed"))
    );
  } catch (err) {
    console.error("Expo push send failed:", err);
    await Promise.all(notificationRows.filter((row) => row.device_id !== null).map((row) => markDelivery(row.id, "failed")));
  }
}

/**
 * กุญแจของ "เหตุการณ์แจ้งเตือนหนึ่งครั้ง" — ใช้ยุบแถวที่ notify() เขียนแยกไว้ต่ออุปกรณ์
 *
 * ตาราง notifications เป็น delivery log (schema §5) จึงมี 1 แถวต่อ 1 อุปกรณ์ที่ยิงไป ถ้าผู้ใช้มี
 * ทั้งมือถือและแท็บเล็ต หรือเคยลงแอปใหม่จนมี device row เก่าค้าง รายการในแอปจะเห็นเรื่องเดียวกัน
 * ซ้ำหลายครั้ง — ซึ่งเป็นรายละเอียดการส่งของเรา ไม่ใช่สิ่งที่ผู้ใช้ควรต้องเข้าใจ
 *
 * ตัด triggered_at เหลือระดับนาที เพราะแต่ละแถวใน notify() ชุดเดียวกัน insert คนละครั้ง
 * เวลาจึงต่างกันได้ระดับมิลลิวินาที
 */
export function eventKey(row: NotificationRow): string {
  const minute = row.triggered_at.slice(0, 16);
  return [
    row.type,
    row.round_instance_id ?? "",
    row.prescription_id ?? "",
    row.medication_log_id ?? "",
    row.appointment_id ?? "",
    minute,
  ].join("|");
}

/**
 * ยุบแถวต่ออุปกรณ์ให้เหลือเหตุการณ์ละรายการ — เก็บแถวใหม่สุดเป็นตัวแทน (repository เรียง
 * ใหม่→เก่ามาแล้ว) และถือว่า "อ่านแล้ว" ถ้ามีสักแถวในกลุ่มถูกอ่าน ผู้ใช้กดอ่านบนเครื่องเดียว
 * จึงไม่เห็นเรื่องเดิมค้างเป็นยังไม่อ่านจากอีกเครื่อง
 */
export function collapseDeviceDuplicates(rows: NotificationRow[]): NotificationRow[] {
  const byEvent = new Map<string, NotificationRow>();

  for (const row of rows) {
    const key = eventKey(row);
    const seen = byEvent.get(key);
    if (!seen) {
      byEvent.set(key, row);
    } else if (row.is_read && !seen.is_read) {
      byEvent.set(key, { ...seen, is_read: true });
    }
  }

  return [...byEvent.values()];
}

export interface ListMyNotificationsOptions extends ListNotificationsOptions {}

export type NotificationListItem = NotificationRow & {
  patient_name: string | null;
  medication_name: string | null;
};

/**
 * กรอง unread หลังยุบซ้ำ ไม่ใช่ก่อน — ไม่งั้นแถวพี่น้องของเรื่องที่อ่านไปแล้วจะโผล่กลับมาเป็น
 * "ยังไม่อ่าน" ทั้งที่ผู้ใช้กดอ่านไปแล้ว (จำนวนที่คืนจึงอาจน้อยกว่า limit ที่ขอมา)
 */
export async function listMyNotifications(
  userId: string,
  options: ListMyNotificationsOptions = {}
): Promise<NotificationListItem[]> {
  const rows = await listForUser(userId, { limit: options.limit });
  const collapsed = collapseDeviceDuplicates(rows);
  const visible = options.unreadOnly ? collapsed.filter((r) => !r.is_read) : collapsed;

  // ประกอบรายละเอียดแบบ batch เพื่อให้ผู้ดูแลรู้ว่าเป็นของผู้ป่วยคนไหนและยาอะไร
  // โดยไม่ยิง query ทีละ notification
  const patientIds = [...new Set(visible.map((row) => row.patient_id))];
  const prescriptionIds = [...new Set(visible.map((row) => row.prescription_id).filter((id): id is string => !!id))];
  const [profiles, prescriptions] = await Promise.all([
    findPatientFullByIds(patientIds),
    findPrescriptionsByIds(prescriptionIds),
  ]);
  const medications = await findMedicationsByIds([...new Set(prescriptions.map((row) => row.medication_id))]);
  const patientNameById = new Map(profiles.map((profile) => [profile.id, `${profile.first_name} ${profile.last_name}`.trim()]));
  const medicationById = new Map(medications.map((medication) => [medication.id, medication]));
  const medicationNameByPrescription = new Map(
    prescriptions.map((prescription) => {
      const medication = medicationById.get(prescription.medication_id);
      return [prescription.prescription_id, medication?.drug_thai_name?.trim() || medication?.drug_name || null] as const;
    }),
  );

  return visible.map((row) => ({
    ...row,
    patient_name: patientNameById.get(row.patient_id) ?? null,
    medication_name: row.prescription_id ? medicationNameByPrescription.get(row.prescription_id) ?? null : null,
  }));
}

export async function markMyNotificationRead(userId: string, id: string): Promise<NotificationRow> {
  return setEventReadState(userId, id, true);
}

export async function markMyNotificationUnread(userId: string, id: string): Promise<NotificationRow> {
  return setEventReadState(userId, id, false);
}

async function eventRows(userId: string, id: string): Promise<NotificationRow[]> {
  const rows = await listForUser(userId);
  const selected = rows.find((row) => row.id === id);
  if (!selected) throw new ApiError(404, "Notification not found");
  const key = eventKey(selected);
  return rows.filter((row) => eventKey(row) === key);
}

async function setEventReadState(userId: string, id: string, isRead: boolean): Promise<NotificationRow> {
  const rows = await eventRows(userId, id);
  await setReadStateForIds(rows.map((row) => row.id), userId, isRead);
  return { ...rows[0], is_read: isRead };
}

export async function markAllMyNotificationsRead(userId: string): Promise<void> {
  await markAllRead(userId);
}

export async function deleteMyNotification(userId: string, id: string): Promise<void> {
  const rows = await eventRows(userId, id);
  await deleteManyForUser(rows.map((row) => row.id), userId);
}
