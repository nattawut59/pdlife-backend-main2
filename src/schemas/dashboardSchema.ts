import { z } from "zod";

/** ช่วงเวลาสูงสุดของตัวนับบนหน้าทะเบียน — ยาวกว่านี้เป็นงานของรายงาน ไม่ใช่จอคัดกรอง */
const MAX_WINDOW_DAYS = 90;
/** เพดานจำนวนผู้ป่วยต่อคำขอ — คลินิกเดียวไม่ควรเกินนี้ และกัน query ที่ลากทั้งฐานออกมา */
const MAX_PATIENTS = 200;

export const rosterQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(MAX_WINDOW_DAYS).optional(),
  limit: z.coerce.number().int().positive().max(MAX_PATIENTS).optional(),
});
export type RosterQuery = z.infer<typeof rosterQuerySchema>;
