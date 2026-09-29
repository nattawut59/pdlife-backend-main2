import * as appointmentRepository from "../repositories/appointmentRepository";
import * as clinicAssessmentRepository from "../repositories/clinicAssessmentRepository";
import * as doctorNoteRepository from "../repositories/doctorNoteRepository";
import { findPatientFullByIds } from "../repositories/patientProfileRepository";
import { findUserById, findUsersByIds } from "../repositories/userRepository";
import { ApiError } from "../utils/ApiError";
import { dateOnly } from "../utils/datetime";
import { generateSlotGrid } from "../schemas/appointmentSchema";
import { assertCanAccessPatient } from "./patientAccessService";
import type { JwtPayload } from "../utils/jwt";
import type {
  AppointmentRow,
  ClinicAssessmentRow,
  DoctorNoteRow,
} from "../types/database";
import type { AssessStatus, VisitStatus, VisitType } from "../config/constants";

/** สถานะฟอร์มคัดกรองของนัดหนึ่ง — null คือยังไม่มีแถวใน clinic_assessments เลย */
export interface AppointmentScreening {
  status: AssessStatus;
  /** ชื่อผู้คัดกรอง เก็บเป็นข้อความในตาราง ไม่ใช่ FK */
  screened_by: string | null;
  submitted_at: string | null;
}

export interface AppointmentEntry {
  id: string;
  patient_id: string;
  /**
   * null เมื่อหาโปรไฟล์ผู้ป่วยของนัดนี้ไม่เจอ
   *
   * ตั้งใจไม่ตัดแถวทิ้ง — นัดที่โยงกับผู้ป่วยที่หาไม่เจอคือข้อมูลผิดปกติที่ต้องมีคนเห็น
   * ถ้าเงียบ ๆ ตัดออกจากตาราง คนไข้คนนั้นจะไม่ถูกเรียกตรวจโดยไม่มีใครรู้ว่าหายไปไหน
   */
  patient_name: string | null;
  hn_number: string | null;
  age: number | null;
  /** จำเป็นเพราะรายการย้อนหลังคละวันกัน — มุมมองรายวันไม่ได้ใช้แต่ส่งมาด้วยเสมอเพื่อให้รูปเดียว */
  visit_date: string;
  visit_time: string | null;
  visit_type: VisitType | null;
  status: VisitStatus;
  doctor_name: string | null;
  screening: AppointmentScreening | null;
  /** เวลาที่แพทย์บันทึกผลการตรวจของนัดนี้ — null คือยังไม่บันทึก */
  doctor_note_at: string | null;
}

const STAFF_ROLES = ["nurse", "doctor", "admin"];

/** รหัสของ Postgres เมื่อชนกับ unique index — ดู migrations/0005_one_appointment_per_doctor_slot.sql */
const UNIQUE_VIOLATION = "23505";

/** เลือกแถวล่าสุดของแต่ละนัด เผื่อกรณีมีซ้ำ — ตารางควรมีนัดละแถว แต่โค้ดต้องไม่พังถ้าไม่ใช่ */
function latestByAppointment<T extends { appointment_id: string }>(
  rows: T[],
  newer: (a: T, b: T) => boolean
): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const current = map.get(row.appointment_id);
    if (!current || newer(row, current)) map.set(row.appointment_id, row);
  }
  return map;
}

/**
 * ประกอบตารางนัดของวันหนึ่งจาก 5 ตาราง
 *
 * แยกออกจากส่วนที่คุยกับฐานข้อมูล เพื่อให้เทสจับการจับคู่ข้อมูลข้ามคนได้โดยไม่ต้องต่อ DB —
 * ความผิดพลาดที่อันตรายที่สุดของหน้าจอแบบนี้คือข้อมูลของคนหนึ่งไปโผล่ในแถวของอีกคน
 */
export function assembleAppointments(input: {
  appointments: AppointmentRow[];
  patients: Array<{ id: string; first_name: string; last_name: string; hn_number: string | null; age: number }>;
  doctors: Array<{ id: string; first_name: string; last_name: string }>;
  assessments: ClinicAssessmentRow[];
  notes: DoctorNoteRow[];
}): AppointmentEntry[] {
  const patientById = new Map(input.patients.map((p) => [p.id, p]));
  const doctorById = new Map(input.doctors.map((d) => [d.id, d]));

  const assessmentByAppointment = latestByAppointment(
    input.assessments,
    (a, b) => (a.submitted_at ?? "") > (b.submitted_at ?? "")
  );
  const noteByAppointment = latestByAppointment(
    input.notes,
    (a, b) => a.created_at > b.created_at
  );

  return input.appointments.map((appointment) => {
    const patient = patientById.get(appointment.patient_id);
    const doctor = appointment.doctor_id ? doctorById.get(appointment.doctor_id) : undefined;
    const assessment = assessmentByAppointment.get(appointment.id);
    const note = noteByAppointment.get(appointment.id);

    return {
      id: appointment.id,
      patient_id: appointment.patient_id,
      patient_name: patient ? `${patient.first_name} ${patient.last_name}` : null,
      hn_number: patient?.hn_number ?? null,
      age: patient?.age ?? null,
      visit_date: appointment.visit_date,
      visit_time: appointment.visit_time,
      visit_type: appointment.visit_type,
      status: appointment.status,
      doctor_name: doctor ? `${doctor.first_name} ${doctor.last_name}` : null,
      screening: assessment
        ? {
            status: assessment.status,
            screened_by: assessment.screened_by,
            submitted_at: assessment.submitted_at,
          }
        : null,
      doctor_note_at: note?.created_at ?? null,
    };
  });
}

/**
 * ตารางนัดของวันหนึ่งทั้งคลินิก
 *
 * ไม่ส่ง date มา = วันนี้ตามปฏิทินไทย ไม่ใช่ UTC — ช่วงเที่ยงคืนถึงเจ็ดโมงเช้าเวลาไทย วันที่
 * ของ UTC ยังเป็นเมื่อวาน ถ้าใช้ UTC พยาบาลที่มาเปิดตอนเช้าจะเห็นตารางของเมื่อวาน
 */
export interface ListAppointmentsOptions {
  date?: string;
  before?: string;
  patient_id?: string;
  limit: number;
}

export async function list(
  requester: JwtPayload,
  options: ListAppointmentsOptions
): Promise<{ date: string | null; appointments: AppointmentEntry[] }> {
  // ตารางนัดทั้งคลินิกเป็นของ staff เท่านั้น — route กันด้วย requireRole อีกชั้น
  if (!STAFF_ROLES.includes(requester.role)) {
    throw new ApiError(403, "Only clinic staff can read the clinic schedule");
  }

  /**
   * เลือกมุมมองตามพารามิเตอร์ที่ส่งมา เรียงตามความเฉพาะเจาะจง
   *
   * ไม่ผสมเงื่อนไขกัน — ขอทั้ง patient_id และ before พร้อมกันจะได้ประวัติของคนนั้น
   * ไม่ใช่ประวัติของคนนั้นก่อนวันนั้น เพราะยังไม่มีหน้าจอไหนต้องการแบบผสม และการรองรับ
   * ไว้ก่อนโดยไม่มีคนใช้ทำให้ต้องเดาว่าอันไหนถูก ตอนวันหนึ่งมีคนเรียกจริง
   */
  let appointments;
  let visitDate: string | null = null;

  if (options.patient_id) {
    appointments = await appointmentRepository.listByPatient(options.patient_id, options.limit);
  } else if (options.before) {
    appointments = await appointmentRepository.listBefore(options.before, options.limit);
  } else {
    visitDate = options.date ?? dateOnly(new Date());
    appointments = await appointmentRepository.listByDate(visitDate);
  }

  return { date: visitDate, appointments: await enrichAppointments(appointments) };
}

/**
 * เติมชื่อผู้ป่วย/แพทย์ และสถานะคัดกรอง/บันทึกแพทย์ให้แถวนัดดิบ — จำนวน query คงที่ไม่ว่าจะมีกี่นัด
 *
 * แยกออกมาเพราะทั้งตารางของ staff และรายการนัดของผู้ป่วยเองต้องได้รูปเดียวกันเป๊ะ ถ้าเขียนสองชุด
 * วันหนึ่งจะแก้ชุดเดียวแล้วสองหน้าจอแสดงไม่ตรงกัน
 */
async function enrichAppointments(appointments: AppointmentRow[]): Promise<AppointmentEntry[]> {
  const appointmentIds = appointments.map((a) => a.id);
  const patientIds = [...new Set(appointments.map((a) => a.patient_id))];
  const doctorIds = [
    ...new Set(appointments.map((a) => a.doctor_id).filter((id): id is string => id !== null)),
  ];

  const [patients, doctors, assessments, notes] = await Promise.all([
    findPatientFullByIds(patientIds),
    findUsersByIds(doctorIds),
    clinicAssessmentRepository.findByAppointmentIds(appointmentIds),
    doctorNoteRepository.findByAppointmentIds(appointmentIds),
  ]);

  return assembleAppointments({ appointments, patients, doctors, assessments, notes });
}

export interface DailyAppointmentCount {
  date: string;
  total: number;
}

/**
 * นับนัดต่อวัน — คืนเฉพาะวันที่มีนัดจริง (sparse)
 *
 * ไม่เติมวันที่ว่างให้ครบช่วง เพราะฝั่งที่เรียกมีรายการวันของตัวเองอยู่แล้ว (ปฏิทินสร้าง 7 ช่อง
 * ของมันเอง) การส่งวันที่ total เป็น 0 มาด้วยคือส่งข้อมูลที่ผู้เรียกไม่ได้ใช้
 */
export function groupCountsByDate(dates: string[]): DailyAppointmentCount[] {
  const byDate = new Map<string, number>();
  for (const date of dates) byDate.set(date, (byDate.get(date) ?? 0) + 1);

  return [...byDate.entries()]
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * จำนวนนัดต่อวันในช่วงหนึ่ง — ใช้วาดจุดบนปฏิทินและการ์ด "นัดที่กำลังจะถึง"
 *
 * เป็นของ staff เท่านั้นเหมือนตารางนัดทั้งคลินิก แม้จะคืนแค่ตัวเลข — จำนวนคนไข้ต่อวันของคลินิก
 * ก็เป็นข้อมูลที่ไม่ควรให้ผู้ป่วยเห็น
 */
export async function listDailyCounts(
  requester: JwtPayload,
  from: string,
  to: string
): Promise<DailyAppointmentCount[]> {
  if (!STAFF_ROLES.includes(requester.role)) {
    throw new ApiError(403, "Only clinic staff can read the clinic schedule");
  }

  return groupCountsByDate(await appointmentRepository.listDatesInRange(from, to));
}

/**
 * นัดของผู้ป่วยคนเดียว — สำหรับแอปฝั่งผู้ป่วย/ผู้ดูแล
 *
 * ต่างจาก list() ตรงที่ไม่ต้องเป็น staff แต่ผ่าน assertCanAccessPatient แทน (ตัวผู้ป่วยเอง หรือ
 * ผู้ดูแลที่ผูกไว้) — ตารางนัดทั้งคลินิกยังเป็นของ staff เท่านั้นเหมือนเดิม
 */
export async function listForPatient(
  requester: JwtPayload,
  patientId: string,
  options: { limit: number; from?: string; to?: string; date?: string }
): Promise<{ appointments: AppointmentEntry[] }> {
  await assertCanAccessPatient(requester, patientId);

  const appointments = await appointmentRepository.listByPatient(
    patientId,
    options.limit,
    options.from,
    options.to,
    options.date
  );
  return { appointments: await enrichAppointments(appointments) };
}

/**
 * ประกอบนัดเดียวให้มีรูปร่างเดียวกับที่ list คืน
 *
 * เพื่อให้ POST ตอบกลับด้วยรูปเดียวกับ GET เว็บจะได้เอาไปแทรกในตารางได้ทันทีโดยไม่ต้อง
 * ยิงคำขอใหม่ทั้งวัน — และไม่ต้องมีตัวแปลงสองชุดให้หลุดกันภายหลัง
 */
async function assembleOne(appointment: AppointmentRow): Promise<AppointmentEntry> {
  const [patients, doctors, assessments, notes] = await Promise.all([
    findPatientFullByIds([appointment.patient_id]),
    findUsersByIds(appointment.doctor_id ? [appointment.doctor_id] : []),
    clinicAssessmentRepository.findByAppointmentIds([appointment.id]),
    doctorNoteRepository.findByAppointmentIds([appointment.id]),
  ]);

  const [entry] = assembleAppointments({
    appointments: [appointment],
    patients,
    doctors,
    assessments,
    notes,
  });
  return entry;
}

export interface CreateAppointmentInput {
  patient_id: string;
  doctor_id?: string | null;
  visit_date: string;
  visit_time?: string | null;
  visit_type: VisitType;
  status: "scheduled" | "checked_in";
  created_by: string;
}

/**
 * กันชนกัน + สร้างแถวจริง — ใช้ร่วมกันทั้งฟอร์มของ staff และการจองเองของผู้ป่วย เพราะกติกา
 * กันชนกัน (คนเดิมจองซ้ำ / หมอคนเดิมชนเวลา) ต้องเหมือนกันเป๊ะไม่ว่าใครเป็นคนกด
 */
async function insertAppointment(input: CreateAppointmentInput): Promise<AppointmentEntry> {
  const visitTime = input.visit_time ?? null;

  // กันการกดปุ่มซ้ำ — คนเดิม วันเดิม เวลาเดิม ไม่มีเหตุผลที่จะเป็นนัดคนละใบ
  const duplicate = await appointmentRepository.findByPatientAndSlot(
    input.patient_id,
    input.visit_date,
    visitTime
  );
  if (duplicate) {
    throw new ApiError(409, "This patient already has an appointment in that slot");
  }

  // กันคิวชนกัน — หมอ 1 คนรับได้ 1 นัดต่อช่วงเวลา (docs/HANDOVER.md "นิยามคิวว่าง")
  // เช็คก่อนแค่ให้ข้อความ error เป็นมิตร ด่านที่รับประกันจริงคือ unique index ใน
  // migrations/0005_one_appointment_per_doctor_slot.sql (อ่านก่อนเขียนมีช่องว่างเสมอ)
  if (input.doctor_id && visitTime) {
    const conflict = await appointmentRepository.findByDoctorAndSlot(
      input.doctor_id,
      input.visit_date,
      visitTime
    );
    if (conflict) {
      throw new ApiError(409, "This doctor already has an appointment in that slot");
    }
  }

  // ชื่อผู้สร้างเก็บคู่กับ id เพื่อให้อ่านประวัติได้โดยไม่ต้อง join และยังตรวจสอบย้อนได้จาก id
  const creator = await findUserById(input.created_by);

  let row: AppointmentRow;
  try {
    row = await appointmentRepository.create({
      patient_id: input.patient_id,
      doctor_id: input.doctor_id ?? null,
      visit_date: input.visit_date,
      visit_time: visitTime,
      visit_type: input.visit_type,
      status: input.status,
      created_by: input.created_by,
      created_appoint_name: creator ? `${creator.first_name} ${creator.last_name}` : null,
    });
  } catch (err) {
    // ช่องว่างระหว่างเช็คกับเขียนข้างบน — สองคนกดจองพร้อมกันแล้วผ่านเช็คทั้งคู่ได้จริง
    // ฐานข้อมูลเป็นด่านสุดท้ายที่รับประกัน (เหตุผลเดียวกับ clinicAssessmentService.ts)
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new ApiError(409, "This doctor already has an appointment in that slot");
    }
    throw err;
  }

  return assembleOne(row);
}

/**
 * สร้างนัด — ใช้ทั้งนัดล่วงหน้าและคนที่เดินเข้ามาเอง
 *
 * ไม่ห้ามสร้างนัดย้อนหลัง โรงพยาบาลคีย์ข้อมูลตามหลังเป็นเรื่องปกติ การห้ามจะทำให้ข้อมูลขาด
 * ไปเลยแทนที่จะมาช้า — หน้าจอเป็นคนเตือนว่าวันที่ผ่านมาแล้ว
 */
export async function create(
  requester: JwtPayload,
  input: Omit<CreateAppointmentInput, "created_by">
): Promise<AppointmentEntry> {
  if (!STAFF_ROLES.includes(requester.role)) {
    throw new ApiError(403, "Only clinic staff can create appointments");
  }

  return insertAppointment({ ...input, created_by: requester.sub });
}

export interface CreateSelfAppointmentInput {
  doctor_id: string;
  visit_date: string;
  visit_time: string;
  visit_type: VisitType;
}

/**
 * ผู้ป่วย/ผู้ดูแลจองนัดเอง — ต่างจาก create() ของ staff ตรงที่ห้ามเว้น doctor_id/visit_time
 * (บังคับตั้งแต่ schema แล้ว) และ status ล็อกเป็น scheduled เสมอ ไม่ให้เลือก
 */
export async function createSelfBooking(
  requester: JwtPayload,
  patientId: string,
  input: CreateSelfAppointmentInput
): Promise<AppointmentEntry> {
  if (requester.role !== "patient" && requester.role !== "caregiver") {
    throw new ApiError(403, "Only the patient or a caregiver can book an appointment");
  }
  await assertCanAccessPatient(requester, patientId, { requireAnswerPermission: true });

  return insertAppointment({
    patient_id: patientId,
    doctor_id: input.doctor_id,
    visit_date: input.visit_date,
    visit_time: input.visit_time,
    visit_type: input.visit_type,
    status: "scheduled",
    created_by: requester.sub,
  });
}

/** ทุก slot ว่าง/ไม่ว่างของหมอคนหนึ่งในวันหนึ่ง — pure, เทสได้โดยไม่ต้องต่อ DB */
export function computeAvailableSlots(
  bookedTimes: string[]
): Array<{ time: string; available: boolean }> {
  const booked = new Set(bookedTimes);
  return generateSlotGrid().map((time) => ({ time, available: !booked.has(time) }));
}

export async function listAvailableSlots(
  doctorId: string,
  date: string
): Promise<Array<{ time: string; available: boolean }>> {
  const bookedTimes = await appointmentRepository.listByDoctorAndDate(doctorId, date);
  return computeAvailableSlots(bookedTimes);
}

/**
 * เปลี่ยนสถานะนัด — เช็คอิน ตรวจเสร็จ ไม่มาตามนัด หรือยกเลิก
 *
 * ไม่มีการลบนัด ใช้ cancelled แทนเสมอ เพราะนัดที่หายไปทำให้ตามไม่ได้ว่าเคยมีคนนัดไหม
 * และ clinic_assessments อ้าง appointment_id อยู่ ลบแล้วฟอร์มคัดกรองจะกำพร้า
 */
export async function updateStatus(
  requester: JwtPayload,
  appointmentId: string,
  status: VisitStatus
): Promise<AppointmentEntry> {
  if (!STAFF_ROLES.includes(requester.role)) {
    throw new ApiError(403, "Only clinic staff can change an appointment status");
  }

  const row = await appointmentRepository.updateStatus(appointmentId, status);
  if (!row) throw new ApiError(404, "Appointment not found");

  return assembleOne(row);
}
