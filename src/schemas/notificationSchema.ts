import { z } from "zod";

/**
 * กันไม่ให้คำขอเดียวลากประวัติแจ้งเตือนทั้งหมดออกมา — แอปแสดงทีละหน้าอยู่แล้ว
 * และ scheduler ยิงแจ้งเตือนหลายครั้งต่อวันต่อคน ประวัติจึงยาวเร็วกว่าตารางอื่น
 */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export const listNotificationsQuerySchema = z.object({
  // ?unread_only=true = มุมมองของจุดแดงบนกระดิ่ง ส่วนไม่ใส่มา = หน้ารายการเต็ม
  unread_only: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
