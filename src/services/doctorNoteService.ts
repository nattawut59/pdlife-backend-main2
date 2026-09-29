import * as appointmentRepository from "../repositories/appointmentRepository";
import * as clinicAssessmentRepository from "../repositories/clinicAssessmentRepository";
import * as doctorNoteRepository from "../repositories/doctorNoteRepository";
import { ApiError } from "../utils/ApiError";
import type { JwtPayload } from "../utils/jwt";
import type { DoctorNoteRow } from "../types/database";
import type { SaveDoctorNoteBody } from "../schemas/doctorNoteSchema";

/**
 * บันทึกผลการตรวจของแพทย์
 *
 * เป็นของ "การมาตรวจครั้งนั้น" เหมือนฟอร์มคัดกรอง — คนเดียวกันมา 5 ครั้งได้ 5 ใบแยกกัน
 * และแต่ละครั้งมีใบเดียว (migration 0004 บังคับ) การแก้คือแก้ใบเดิม ไม่ใช่เขียนใบใหม่ทับ
 */

/** อ่านได้ทุกคนในคลินิก — พยาบาลต้องรู้แผนการรักษาเพื่อทำงานต่อ */
const STAFF_ROLES = ["nurse", "doctor", "admin"];

/**
 * เขียนได้เฉพาะแพทย์
 *
 * ต่างจากฟอร์มคัดกรองที่พยาบาลเป็นคนกรอก — บันทึกผลการตรวจคือความเห็นทางการแพทย์และมี
 * การปรับยาอยู่ข้างใน จึงต้องมาจากคนที่รับผิดชอบการรักษาจริง admin รวมอยู่ด้วยเพราะเป็น
 * บทบาทที่แก้ข้อมูลผิดพลาดได้ทุกอย่างอยู่แล้ว
 */
const WRITER_ROLES = ["doctor", "admin"];

/** รหัสของ Postgres เมื่อชนกับ unique index */
const UNIQUE_VIOLATION = "23505";

export async function getByAppointment(
  requester: JwtPayload,
  appointmentId: string
): Promise<DoctorNoteRow | null> {
  if (!STAFF_ROLES.includes(requester.role)) {
    throw new ApiError(403, "Only clinic staff can read a doctor note");
  }
  return doctorNoteRepository.findByAppointmentId(appointmentId);
}

export async function save(
  requester: JwtPayload,
  appointmentId: string,
  input: SaveDoctorNoteBody
): Promise<DoctorNoteRow> {
  if (!WRITER_ROLES.includes(requester.role)) {
    throw new ApiError(403, "Only a doctor can write a doctor note");
  }

  const appointment = await appointmentRepository.findById(appointmentId);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  const existing = await doctorNoteRepository.findByAppointmentId(appointmentId);

  /**
   * โยงกับฟอร์มคัดกรองใบที่มีอยู่ตอนบันทึก
   *
   * ตอบคำถามว่าบันทึกนี้เขียนขึ้นโดยอ่านฟอร์มใบไหน ซึ่งจำเป็นเมื่อฟอร์มถูกแก้ทีหลัง —
   * ไม่มีคอลัมน์นี้ก็ยังโยงผ่าน appointment_id ได้ แต่จะแยกไม่ออกว่าตอนนั้นมีฟอร์มหรือยัง
   */
  const assessment = await clinicAssessmentRepository.findByAppointmentId(appointmentId);

  const payload: Record<string, unknown> = {
    clinical_note: input.clinical_note?.trim() || null,
    medication_adjustment: input.medication_adjustment,
    reason_for_change: input.reason_for_change?.trim() || null,
    follow_up_urgency: input.follow_up_urgency ?? null,
    next_appointment_date: input.next_appointment_date ?? null,
    assessment_id: assessment?.id ?? null,
  };

  let note: DoctorNoteRow;

  if (existing) {
    // doctor_id ไม่เปลี่ยนตอนแก้ — เก็บไว้ว่าใครเป็นเจ้าของบันทึกใบนี้
    note = await doctorNoteRepository.update(existing.id, payload);
  } else {
    try {
      note = await doctorNoteRepository.insert({
        ...payload,
        appointment_id: appointmentId,
        doctor_id: requester.sub,
      });
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        throw new ApiError(409, "มีบันทึกของนัดนี้อยู่แล้ว — เปิดใหม่อีกครั้งเพื่อแก้ใบเดิม");
      }
      throw err;
    }
  }

  /**
   * บันทึกผลตรวจแล้ว = การมาตรวจครั้งนี้จบ
   *
   * ตั้งให้อัตโนมัติแทนที่จะรอให้ใครมากดปุ่ม เพราะการบันทึกผลคือสิ่งสุดท้ายที่เกิดขึ้นจริง
   * ในการตรวจหนึ่งครั้ง ถ้าให้กดเอง วันหนึ่งตารางจะเต็มไปด้วยนัดที่ค้างเป็น "กำลังรอ"
   * ทั้งที่ตรวจไปหมดแล้ว
   *
   * ไม่แตะนัดที่ยกเลิกหรือไม่มาตามนัด — สองอย่างนั้นเป็นข้อเท็จจริงที่เกิดไปแล้ว การบันทึก
   * ย้อนหลังไม่ควรลบทิ้ง (แก้กลับได้เองด้วยปุ่มสถานะถ้าตั้งผิด)
   */
  if (appointment.status === "scheduled" || appointment.status === "checked_in") {
    await appointmentRepository.updateStatus(appointmentId, "completed");
  }

  return note;
}
