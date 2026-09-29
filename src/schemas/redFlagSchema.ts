import { z } from "zod";

/**
 * ช่วงเวลาสูงสุดที่ยอมให้ขอ — กันไม่ให้ query เดียวลากทั้งประวัติผู้ป่วยออกมา
 * ธงที่เก่ากว่านี้เป็นงานของรายงาน ไม่ใช่หน้าจอที่หมอเปิดดูระหว่างตรวจ
 */
const MAX_WINDOW_DAYS = 365;

export const listRedFlagsQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(MAX_WINDOW_DAYS).optional(),
  // ?reviewed=false = เอาเฉพาะที่ยังไม่มีใครดู ซึ่งเป็นมุมมองหลักที่พยาบาลใช้
  reviewed: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});
export type ListRedFlagsQuery = z.infer<typeof listRedFlagsQuerySchema>;

/**
 * ค่าเริ่มต้นเป็น true — การกดปุ่มบนหน้าจอคือ "รับทราบ" ส่วน false ใช้ตอนกดผิดแล้วเปิดกลับ
 */
export const reviewRedFlagSchema = z.object({
  reviewed: z.boolean().default(true),
});
export type ReviewRedFlagBody = z.infer<typeof reviewRedFlagSchema>;
