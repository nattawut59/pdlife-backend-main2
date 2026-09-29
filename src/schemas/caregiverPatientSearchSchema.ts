import { z } from "zod";

// รูปแบบจริง (13 หลัก / HN) เช็คใน caregiverService.ts ไม่ใช่ที่นี่ — ผิดรูปแบบก็แค่ "หาไม่เจอ"
// (404 เดียวกับเลขที่ถูกรูปแบบแต่ไม่มีในระบบ) ไม่ต้องแยก 400 ให้เดาได้ว่ารูปแบบไหน "ถูก"
export const searchPatientByIdentifierQuerySchema = z.object({
  identifier: z.string().trim().min(1),
});

export const linkPatientByIdentifierSchema = z.object({
  identifier: z.string().trim().min(1),
  relationship: z.string().min(1).optional(),
});
