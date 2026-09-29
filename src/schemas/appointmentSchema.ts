import { z } from "zod";
import {
  APPOINTMENT_SLOT_MINUTES,
  CLINIC_CLOSE_TIME,
  CLINIC_OPEN_TIME,
  VISIT_STATUSES,
  VISIT_TYPES,
} from "../config/constants";
import { dateOnly } from "../utils/datetime";

/**
 * ?date=YYYY-MM-DD — ไม่ส่งมาแปลว่าวันนี้
 *
 * ใช้ z.string().date() ของ zod แทนการเขียน regex เอง เพราะมันตรวจถึงขั้นว่าวันที่นั้นมีจริง
 * ไหม (2569-02-31 ไม่ผ่าน) ซึ่ง regex รูปแบบตัวเลขล้วนตรวจไม่ได้
 *
 * ไม่จำกัดช่วงย้อนหลัง เพราะคำขอนี้ดึงแค่วันเดียวเสมอ ไม่มีทางลากทั้งประวัติออกมาได้
 */
const MAX_LIMIT = 100;
const MAX_COUNT_RANGE_DAYS = 31;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * สามมุมมองของตารางนัด ใช้ endpoint เดียวกัน
 *
 *   ?date=          วันเดียว — ตารางนัดประจำวัน (ไม่ส่งอะไรมาเลย = วันนี้)
 *   ?before=        นัดที่ผ่านมาแล้ว เรียงล่าสุดก่อน — รายการ "บันทึกที่ผ่านมา"
 *   ?patient_id=    ทุกครั้งที่คนนี้มาตรวจ — แท็บในเวชระเบียนรายคน
 *
 * ใช้ endpoint เดียวเพราะทั้งสามคืนข้อมูลรูปเดียวกันเป๊ะ (นัด + สถานะคัดกรอง + สถานะบันทึก
 * ของแพทย์) ต่างกันแค่เงื่อนไขการค้น — แยกเป็นสาม endpoint จะได้โค้ดประกอบข้อมูลสามชุด
 * ที่ต้องแก้พร้อมกันทุกครั้ง
 */
export const listAppointmentsQuerySchema = z.object({
  date: z.string().date().optional(),
  before: z.string().date().optional(),
  patient_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(20),
});
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

/**
 * นัดของผู้ป่วยคนเดียว — สำหรับแอปฝั่งผู้ป่วย/ผู้ดูแล
 *
 *   (ไม่ส่งอะไรมา)  ทุกนัดของคนนี้ เรียงล่าสุดก่อน — หน้ารายการนัด/ประวัติ
 *   ?from=          ตั้งแต่วันนั้นเป็นต้นไป เรียงใกล้สุดก่อน — การ์ด "นัดที่จะถึง" บนหน้าแรก
 *
 * เจตนาให้ endpoint เดียวครอบทั้งสามหน้าจอของแอป (หน้าแรก รายการ ประวัติ) แทนที่จะแยกเป็น
 * .../appointments/upcoming ต่างหาก ซึ่งจะได้โค้ดประกอบข้อมูลสองชุดที่ต้องแก้พร้อมกันตลอด
 */
export const listPatientAppointmentsQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  date: z.string().date().optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(20),
}).refine((value) => !(value.date && (value.from || value.to)), {
  message: "`date` cannot be combined with `from` or `to`",
}).refine((value) => !value.to || !!value.from, {
  message: "`to` requires `from`",
}).refine((value) => !value.from || !value.to || value.from <= value.to, {
  message: "`from` must be on or before `to`",
}).refine((value) => {
  if (!value.from || !value.to) return true;
  return (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / MS_PER_DAY < MAX_COUNT_RANGE_DAYS;
}, {
  message: `Appointment range must be shorter than ${MAX_COUNT_RANGE_DAYS} days`,
});
export type ListPatientAppointmentsQuery = z.infer<typeof listPatientAppointmentsQuerySchema>;

/**
 * จำนวนนัดต่อวันในช่วงหนึ่ง — สำหรับจุดบนปฏิทินและการ์ด "นัดที่กำลังจะถึง"
 *
 * จำกัดหนึ่งเดือนเพราะทั้งสองจุดที่ใช้ขอแค่ 7 วัน — เพดานนี้เผื่อไว้ให้มุมมองรายเดือนในอนาคต
 * แต่ยังกันไม่ให้คำขอเดียวกวาดทั้งปีมานับ
 */
export const listAppointmentCountsQuerySchema = z
  .object({
    from: z.string().date(),
    to: z.string().date(),
  })
  .refine((v) => v.from <= v.to, {
    message: "`from` must be on or before `to`",
  })
  .refine(
    (v) => (Date.parse(`${v.to}T00:00:00Z`) - Date.parse(`${v.from}T00:00:00Z`)) / MS_PER_DAY < MAX_COUNT_RANGE_DAYS,
    { message: `Date range must be shorter than ${MAX_COUNT_RANGE_DAYS} days` },
  );
export type ListAppointmentCountsQuery = z.infer<typeof listAppointmentCountsQuerySchema>;

/**
 * ตรวจรูปแบบเวลา HH:MM เอง ไม่ใช้ z.string().time()
 *
 * เพราะตัวนั้นบังคับ HH:MM:SS ส่วนช่องกรอกเวลาบนหน้าเว็บส่งมาเป็น HH:MM — จะให้ฝั่งเว็บ
 * เติม :00 ต่อท้ายก็ได้ แต่การให้ API รับรูปแบบที่ผู้ใช้กรอกจริงตรง ๆ พลาดยากกว่า
 */
function isHourMinute(value: string): boolean {
  const parts = value.split(":");
  if (parts.length !== 2) return false;
  if (parts[0].length !== 2 || parts[1].length !== 2) return false;

  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false;
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60;
}

/**
 * เวลาที่ขอตรงกับ slot boundary (ทุก APPOINTMENT_SLOT_MINUTES นาที) และอยู่ในเวลาทำการไหม
 *
 * เช็คแค่ "รูปแบบเวลาที่ส่งมาถูกต้องไหม" เท่านั้น ไม่ได้เช็คว่า slot นั้นมีคนจองไปแล้วหรือยัง —
 * อันนั้นเป็นหน้าที่ของ findByDoctorAndSlot ใน service กับ unique index ใน migration 0005
 * (ตั้งใจแยกกัน: อันนี้เป็น pure function ตรวจได้โดยไม่ต้องต่อฐานข้อมูล)
 */
export function isValidSlotTime(time: string): boolean {
  const totalMinutes = toMinutes(time);
  if (totalMinutes % APPOINTMENT_SLOT_MINUTES !== 0) return false;
  return totalMinutes >= toMinutes(CLINIC_OPEN_TIME) && totalMinutes < toMinutes(CLINIC_CLOSE_TIME);
}

function toMinutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(":").map(Number);
  return hour * 60 + minute;
}

function fromMinutes(totalMinutes: number): string {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * ทุก slot boundary ในเวลาทำการ (ไม่มีตารางเวรหมอในระบบ — ทุกคนว่างได้ทุกวันในเวลานี้เหมือนกัน
 * ดู docs/HANDOVER.md ข้อ 3) ใช้ค่าคงที่เดียวกับที่ isValidSlotTime เทียบอยู่แล้ว
 */
export function generateSlotGrid(): string[] {
  const slots: string[] = [];
  for (
    let minutes = toMinutes(CLINIC_OPEN_TIME);
    minutes < toMinutes(CLINIC_CLOSE_TIME);
    minutes += APPOINTMENT_SLOT_MINUTES
  ) {
    slots.push(fromMinutes(minutes));
  }
  return slots;
}

export const listAvailableSlotsQuerySchema = z.object({
  doctor_id: z.string().uuid(),
  date: z.string().date(),
});
export type ListAvailableSlotsQuery = z.infer<typeof listAvailableSlotsQuerySchema>;

export const createAppointmentSchema = z
  .object({
    patient_id: z.string().uuid(),
    // ยังไม่ระบุแพทย์ได้ — คลินิกบางแห่งจัดหมอตอนเช้าวันตรวจ ไม่ใช่ตอนนัด
    doctor_id: z.string().uuid().nullable().optional(),
    visit_date: z.string().date(),
    visit_time: z.string().refine(isHourMinute, "เวลาต้องอยู่ในรูปแบบ HH:MM").nullable().optional(),
    visit_type: z.enum(VISIT_TYPES),
    /**
     * สร้างได้แค่สองสถานะนี้
     *
     * นัดล่วงหน้าเริ่มที่ scheduled ส่วน walk-in เริ่มที่ checked_in เพราะคนยืนอยู่ที่เคาน์เตอร์แล้ว
     * ส่วน completed / missed / cancelled เป็นผลของสิ่งที่เกิดขึ้นทีหลัง ต้องมาทาง PATCH
     * ไม่ใช่ตั้งไว้ตั้งแต่ตอนสร้าง
     */
    status: z.enum(["scheduled", "checked_in"]).default("scheduled"),
  })
  /**
   * ตรวจ slot boundary เฉพาะเมื่อมี doctor_id — นัดที่ยังไม่ระบุหมอไม่ต้องตรง slot เพราะยัง
   * ไม่รู้ว่าจะไปชนช่วงเวลาของใคร (unique index ก็ไม่บังคับกรณีนี้เหมือนกัน ดู migration 0005)
   */
  .superRefine((data, ctx) => {
    if (!data.doctor_id || !data.visit_time) return;
    if (!isValidSlotTime(data.visit_time)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visit_time"],
        message: `เวลานัดต้องตรงช่วง ${APPOINTMENT_SLOT_MINUTES} นาที (${CLINIC_OPEN_TIME}-${CLINIC_CLOSE_TIME}) เมื่อระบุแพทย์แล้ว`,
      });
    }
  });
export type CreateAppointmentBody = z.infer<typeof createAppointmentSchema>;

/**
 * ผู้ป่วย/ผู้ดูแลจองนัดเอง — กติกาเข้มกว่าฟอร์มของ staff ข้างบนทุกจุด เพราะการจองเองต้องได้
 * นัดที่ใช้ได้จริงทันที ไม่มี "ไว้ค่อยจัดคิว" หรือ "คีย์ย้อนหลัง" แบบที่ staff ทำได้
 */
export const createSelfAppointmentSchema = z
  .object({
    doctor_id: z.string().uuid(),
    visit_date: z.string().date(),
    visit_time: z.string().refine(isHourMinute, "เวลาต้องอยู่ในรูปแบบ HH:MM"),
    // จองเองได้แค่นัดปกติ — urgent ควรโทรหาคลินิกโดยตรง, walk_in ขัดกับนิยามของการจองล่วงหน้า
    visit_type: z.enum(["routine", "follow_up"]),
  })
  .superRefine((data, ctx) => {
    if (data.visit_date < dateOnly(new Date())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visit_date"],
        message: "จองย้อนหลังไม่ได้",
      });
    }
    if (!isValidSlotTime(data.visit_time)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visit_time"],
        message: `เวลานัดต้องตรงช่วง ${APPOINTMENT_SLOT_MINUTES} นาที (${CLINIC_OPEN_TIME}-${CLINIC_CLOSE_TIME})`,
      });
    }
  });
export type CreateSelfAppointmentBody = z.infer<typeof createSelfAppointmentSchema>;

/** เปลี่ยนสถานะได้ทุกค่าที่ฐานข้อมูลมี รวม cancelled ซึ่งใช้แทนการลบ */
export const updateAppointmentStatusSchema = z.object({
  status: z.enum(VISIT_STATUSES),
});
export type UpdateAppointmentStatusBody = z.infer<typeof updateAppointmentStatusSchema>;

/** ?role=doctor — จำกัดให้ขอได้เฉพาะบทบาทบุคลากร ไม่ให้ใช้ดึงรายชื่อผู้ป่วยทั้งระบบ */
export const listStaffQuerySchema = z.object({
  role: z.enum(["nurse", "doctor", "admin"]).default("doctor"),
});
export type ListStaffQuery = z.infer<typeof listStaffQuerySchema>;
