import { z } from "zod";
import { ASSESSMENT_ITEM_KEYS, type AssessmentItemKey } from "../config/constants";

/**
 * ฟอร์มคัดกรองก่อนพบแพทย์ — 26 อาการ
 *
 * สร้าง shape จาก ASSESSMENT_ITEM_KEYS แทนการพิมพ์ 26 บรรทัดซ้ำ เพื่อให้มีรายชื่ออาการ
 * อยู่ที่เดียว — ถ้าเขียนแยกกันสองที่ วันหนึ่งจะมีอาการที่ผ่าน validation แต่ไม่ถูกบันทึก
 * หรือถูกบันทึกแต่ไม่ผ่าน validation โดยไม่มีอะไรเตือน
 */
const itemShape = Object.fromEntries(
  ASSESSMENT_ITEM_KEYS.map((key) => [key, z.boolean().default(false)])
) as Record<AssessmentItemKey, z.ZodDefault<z.ZodBoolean>>;

/**
 * ไม่รับ patient_id จากผู้เรียก
 *
 * ตัว service อ่านจากนัดหมายเอง — ถ้ารับมาจากข้างนอก จะมีทางที่ฟอร์มคัดกรองของคนหนึ่ง
 * ถูกผูกเข้ากับผู้ป่วยอีกคนได้ ซึ่งเป็นความผิดพลาดที่มองไม่เห็นจนกว่าแพทย์จะตรวจไปแล้ว
 */
export const saveAssessmentSchema = z.object({
  ...itemShape,
  has_caregiver: z.boolean().default(false),
  other_note: z.string().max(2000).nullable().optional(),
  /**
   * ชื่อผู้คัดกรอง — เว้นว่างมาได้ service จะเติมชื่อเจ้าของบัญชีที่ล็อกอินให้
   *
   * แก้ได้เพราะคลินิกมักมีเครื่องกลางเปิดค้างไว้แล้วพยาบาลหลายคนสลับกันใช้ คนคัดกรองจริง
   * จึงไม่ใช่เจ้าของบัญชีเสมอไป ส่วน nurse_id ยังบันทึกบัญชีที่กดบันทึกไว้เสมอและแก้ไม่ได้
   */
  screened_by: z.string().max(200).nullable().optional(),
  /**
   * doctor_opened เปลี่ยนที่นี่ไม่ได้ — เป็นสิ่งที่เกิดตอนแพทย์เปิดอ่าน ไม่ใช่สิ่งที่พยาบาลตั้ง
   */
  status: z.enum(["draft", "submitted"]).default("draft"),
});
export type SaveAssessmentBody = z.infer<typeof saveAssessmentSchema>;
