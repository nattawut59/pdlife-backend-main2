import * as appointmentRepository from "../repositories/appointmentRepository";
import * as clinicAssessmentRepository from "../repositories/clinicAssessmentRepository";
import { findUserById } from "../repositories/userRepository";
import { ApiError } from "../utils/ApiError";
import type { JwtPayload } from "../utils/jwt";
import type { ClinicAssessmentRow } from "../types/database";
import type { SaveAssessmentBody } from "../schemas/clinicAssessmentSchema";

/**
 * ฟอร์มคัดกรองที่พยาบาลกรอกก่อนผู้ป่วยพบแพทย์
 *
 * ฟอร์มเป็นของ "การมาตรวจครั้งนั้น" ไม่ใช่ของตัวผู้ป่วย — คนเดียวกันมา 5 ครั้งต้องได้ 5 ใบ
 * แยกกัน และแต่ละครั้งมีใบเดียว เหมือนฟอร์มกระดาษที่คลินิกใช้อยู่
 */

const STAFF_ROLES = ["nurse", "doctor", "admin"];

/** รหัสของ Postgres เมื่อชนกับ unique index — migration 0003 บังคับหนึ่งนัดหนึ่งฟอร์ม */
const UNIQUE_VIOLATION = "23505";

function assertStaff(requester: JwtPayload, action: string): void {
  if (!STAFF_ROLES.includes(requester.role)) {
    throw new ApiError(403, `Only clinic staff can ${action}`);
  }
}

export async function getByAppointment(
  requester: JwtPayload,
  appointmentId: string
): Promise<ClinicAssessmentRow | null> {
  assertStaff(requester, "read a screening form");
  return clinicAssessmentRepository.findByAppointmentId(appointmentId);
}

/**
 * บันทึกฟอร์ม — มีอยู่แล้วก็แก้ ยังไม่มีก็สร้าง
 *
 * อ่านก่อนเขียนแล้วยังจับ unique violation ซ้ำอีกชั้น เพราะระหว่างสองคำสั่งนั้นมีช่องว่างเสมอ
 * พยาบาลสองคนที่กดพร้อมกันจะอ่านได้ว่า "ยังไม่มี" ทั้งคู่ แล้วต่างคนต่างสร้าง — ฐานข้อมูล
 * เป็นที่เดียวที่กันได้จริง โค้ดตรงนี้แค่แปลง error ให้เป็นข้อความที่หน้าจออ่านรู้เรื่อง
 */
export async function save(
  requester: JwtPayload,
  appointmentId: string,
  input: SaveAssessmentBody
): Promise<ClinicAssessmentRow> {
  assertStaff(requester, "save a screening form");

  const appointment = await appointmentRepository.findById(appointmentId);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  const existing = await clinicAssessmentRepository.findByAppointmentId(appointmentId);

  const { status, screened_by, ...answers } = input;

  /**
   * ชื่อผู้คัดกรองเว้นว่างมาได้ — เติมชื่อเจ้าของบัญชีให้
   *
   * ปกติพยาบาลไม่ต้องพิมพ์อะไร แต่แก้ได้เมื่อคนคัดกรองไม่ใช่เจ้าของบัญชีที่ล็อกอินค้างไว้
   * ซึ่งเกิดขึ้นจริงเมื่อคลินิกใช้เครื่องกลางร่วมกัน
   */
  let screenedBy = screened_by?.trim() || null;
  if (!screenedBy) {
    const user = await findUserById(requester.sub);
    screenedBy = user ? `${user.first_name} ${user.last_name}` : null;
  }

  const payload: Record<string, unknown> = {
    ...answers,
    status,
    screened_by: screenedBy,
    /**
     * ประทับเวลาที่ส่งใหม่ทุกครั้งที่กดส่ง ไม่ได้เก็บแค่ครั้งแรก
     *
     * ตารางนี้ไม่มีคอลัมน์ updated_at แพทย์จึงไม่มีทางรู้ว่าฟอร์มถูกแก้หลังจากที่ตัวเองอ่าน
     * ไปแล้วหรือเปล่า — การให้ submitted_at เป็น "ส่งครั้งล่าสุด" ทำให้เทียบกับ
     * doctor_opened_at ได้ว่าใบนี้เปลี่ยนหลังอ่านไหม ซึ่งมีค่ากว่าการรู้ว่าส่งครั้งแรกเมื่อไหร่
     */
    submitted_at: status === "submitted" ? new Date().toISOString() : null,
  };

  if (existing) {
    // nurse_id ไม่เปลี่ยนตอนแก้ — เก็บไว้ว่าบัญชีไหนเป็นคนสร้างฟอร์มใบนี้
    return clinicAssessmentRepository.update(existing.id, payload);
  }

  try {
    return await clinicAssessmentRepository.insert({
      ...payload,
      appointment_id: appointmentId,
      // อ่านจากนัดหมายเสมอ ไม่รับจากผู้เรียก — ป้องกันฟอร์มไปผูกกับผู้ป่วยผิดคน
      patient_id: appointment.patient_id,
      nurse_id: requester.sub,
    });
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new ApiError(409, "มีฟอร์มคัดกรองของนัดนี้อยู่แล้ว — เปิดใหม่อีกครั้งเพื่อแก้ใบเดิม");
    }
    throw err;
  }
}

/**
 * บันทึกว่าแพทย์เปิดอ่านฟอร์มคัดกรองแล้ว
 *
 * ทำให้แถบเตือนในฟอร์มพยาบาลมีความหมาย — พยาบาลที่กลับมาแก้ทีหลังจะรู้ว่าแพทย์อ่าน
 * ไปแล้วและอาจเขียนบันทึกโดยอ้างอิงข้อมูลชุดเดิม
 *
 * เฉพาะแพทย์เท่านั้น พยาบาลเปิดดูฟอร์มตัวเองไม่นับเป็น "แพทย์อ่านแล้ว"
 *
 * เงียบเมื่อยังไม่มีฟอร์ม — แพทย์เปิดหน้าต่างตรวจของคนที่ยังไม่ถูกคัดกรองเป็นเรื่องปกติ
 * ไม่ใช่ข้อผิดพลาดที่ต้องแจ้ง
 */
export async function markOpened(
  requester: JwtPayload,
  appointmentId: string
): Promise<ClinicAssessmentRow | null> {
  if (requester.role !== "doctor" && requester.role !== "admin") return null;

  const existing = await clinicAssessmentRepository.findByAppointmentId(appointmentId);
  if (!existing) return null;

  // เปิดซ้ำไม่เขียนทับเวลาเดิม — คำถามที่ต้องตอบคือ "อ่านครั้งแรกเมื่อไหร่" ไม่ใช่ครั้งล่าสุด
  if (existing.doctor_opened_at) return existing;

  const patch: Record<string, unknown> = { doctor_opened_at: new Date().toISOString() };

  /**
   * เลื่อนสถานะเฉพาะใบที่ส่งแล้ว
   *
   * ร่างที่พยาบาลยังทำไม่เสร็จแล้วแพทย์บังเอิญเปิดดู ยังเป็นร่างอยู่ — ถ้าเปลี่ยนเป็น
   * doctor_opened รายการงานของพยาบาลจะถือว่าเสร็จแล้วและคนนั้นจะหลุดจากคิว
   */
  if (existing.status === "submitted") patch.status = "doctor_opened";

  return clinicAssessmentRepository.update(existing.id, patch);
}
