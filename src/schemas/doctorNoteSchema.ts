import { z } from "zod";
import { URGENCIES } from "../config/constants";

/**
 * บันทึกผลการตรวจของแพทย์
 *
 * ไม่รับ doctor_id, appointment_id หรือ assessment_id จากผู้เรียก — service อ่านเองจาก
 * token และจากนัดหมาย ถ้ารับมาจากข้างนอกจะมีทางที่บันทึกของแพทย์คนหนึ่งถูกบันทึกในชื่อ
 * ของอีกคน หรือไปผูกกับการมาตรวจผิดครั้ง
 */
export const saveDoctorNoteSchema = z
  .object({
    clinical_note: z.string().max(5000).nullable().optional(),
    medication_adjustment: z.boolean().default(false),
    reason_for_change: z.string().max(2000).nullable().optional(),
    follow_up_urgency: z.enum(URGENCIES).nullable().optional(),
    next_appointment_date: z.string().date().nullable().optional(),
  })
  /**
   * ปรับยาต้องมีเหตุผลกำกับเสมอ
   *
   * ฐานข้อมูลไม่ได้บังคับ แต่การปรับยาที่ไม่มีเหตุผลบันทึกไว้คือช่องโหว่ของเวชระเบียน —
   * เดือนหน้าไม่มีใครตอบได้ว่าทำไมถึงเปลี่ยน รวมถึงตัวแพทย์เอง
   *
   * ตรวจที่ API ด้วย ไม่ใช่แค่ที่หน้าจอ เพราะกฎนี้เป็นเรื่องความถูกต้องของเวชระเบียน
   * ไม่ใช่เรื่องความสะดวกของฟอร์ม
   */
  .refine((v) => !v.medication_adjustment || Boolean(v.reason_for_change?.trim()), {
    message: "ระบุเหตุผลที่ปรับยาด้วย — การปรับยาที่ไม่มีเหตุผลบันทึกไว้ ย้อนมาอธิบายทีหลังไม่ได้",
    path: ["reason_for_change"],
  });
export type SaveDoctorNoteBody = z.infer<typeof saveDoctorNoteSchema>;
