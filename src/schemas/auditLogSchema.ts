import { z } from "zod";
import { AUDIT_ACTIONS } from "../config/constants";

const MAX_LIMIT = 200;

/**
 * ?target_table=   ตารางที่ถูกแก้ (เช่น "appointments", "patient_medications")
 * ?user_id=        เฉพาะการกระทำของบัญชีนี้
 * ?action=         CREATE/UPDATE/DELETE (READ อยู่ใน enum เผื่ออนาคต แต่ตอนนี้ไม่มีแถวจริง —
 *                  ดูเหตุผลใน middlewares/auditLog.ts ว่าทำไมไม่ log READ)
 * ?before=         ดูรายการก่อนเวลานี้ — รูปแบบเดียวกับ /api/appointments?before= สำหรับเลื่อนหน้า
 * ?limit=          1..200 ค่าเริ่มต้น 50
 */
export const listAuditLogsQuerySchema = z.object({
  target_table: z.string().optional(),
  user_id: z.string().uuid().optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(50),
});
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
