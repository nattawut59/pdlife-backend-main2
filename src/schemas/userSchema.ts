import { z } from "zod";
import { phoneField } from "./authSchema";

/**
 * ค้นผู้ดูแลจากเบอร์โทร — ใช้ตอนผู้ป่วยผูกผู้ดูแลเข้าบัญชีตัวเอง
 *
 * ใช้ `phoneField` ตัวเดียวกับตอนสมัครสมาชิกโดยตั้งใจ เพราะตอนสมัครเบอร์ถูกแปลงเป็นรูป
 * `+66...` ก่อนเก็บ ถ้าที่นี่ค้นด้วยข้อความดิบที่ผู้ใช้พิมพ์ (081-234-5678) จะไม่มีวันเจอสักคน
 * และหน้าจอจะขึ้นว่า "ไม่พบผู้ดูแล" ตลอดไปโดยไม่มีใครรู้ว่าเพราะอะไร
 */
export const lookupCaregiverQuerySchema = z.object({
  phone: phoneField,
});
export type LookupCaregiverQuery = z.infer<typeof lookupCaregiverQuerySchema>;

export const updateMyPreferencesSchema = z.object({
  preferred_language: z.enum(["th", "en"]),
});
