import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleAppointments, create, updateStatus } from "../src/services/appointmentService";
import {
  createAppointmentSchema,
  updateAppointmentStatusSchema,
} from "../src/schemas/appointmentSchema";
import { ApiError } from "../src/utils/ApiError";
import type { AppointmentRow, ClinicAssessmentRow, DoctorNoteRow } from "../src/types/database";

/**
 * ตารางนัดประกอบข้อมูลจาก 5 ตารางเข้าด้วยกัน ความผิดพลาดที่อันตรายที่สุดจึงไม่ใช่หน้าช้า
 * แต่คือ **ข้อมูลของคนหนึ่งไปโผล่ในแถวของอีกคน** — ชื่อผู้ป่วยคนหนึ่งคู่กับสถานะคัดกรองของ
 * อีกคน แล้วพยาบาลเรียกผิดคน หรือแพทย์เปิดฟอร์มคัดกรองของคนอื่นมาอ่านก่อนตรวจ
 *
 * เทสจึงจงใจสลับลำดับแถวที่ป้อนเข้าไปให้ไม่ตรงกัน ถ้าโค้ดเผลอจับคู่ด้วยตำแหน่ง (index)
 * แทน id จะพังทันที
 */

const appt = (over: Partial<AppointmentRow>): AppointmentRow =>
  ({
    id: "a1",
    patient_id: "p1",
    doctor_id: null,
    visit_date: "2026-08-24",
    visit_time: "09:00",
    visit_type: "routine",
    status: "scheduled",
    created_by: null,
    created_appoint_name: null,
    created_at: "2026-08-01T00:00:00Z",
    ...over,
  }) as AppointmentRow;

const patient = (id: string, name: string, age: number) => ({
  id,
  first_name: name,
  last_name: "ทดสอบ",
  hn_number: `HN-${id}`,
  age,
});

const assessment = (over: Partial<ClinicAssessmentRow>): ClinicAssessmentRow =>
  ({
    id: "c1",
    appointment_id: "a1",
    patient_id: "p1",
    status: "submitted",
    screened_by: "พยาบาลเอ",
    submitted_at: "2026-08-24T02:00:00Z",
    ...over,
  }) as ClinicAssessmentRow;

const note = (over: Partial<DoctorNoteRow>): DoctorNoteRow =>
  ({
    id: "n1",
    appointment_id: "a1",
    created_at: "2026-08-24T03:00:00Z",
    ...over,
  }) as DoctorNoteRow;

test("จับคู่ด้วย id ไม่ใช่ลำดับแถว — ป้อนสลับลำดับแล้วต้องยังตรงคน", () => {
  const rows = assembleAppointments({
    appointments: [appt({ id: "a1", patient_id: "p1" }), appt({ id: "a2", patient_id: "p2" })],
    // ลำดับกลับด้านกับตารางนัดโดยตั้งใจ
    patients: [patient("p2", "สอง", 70), patient("p1", "หนึ่ง", 60)],
    doctors: [],
    assessments: [assessment({ appointment_id: "a2", patient_id: "p2", screened_by: "พยาบาลบี" })],
    notes: [],
  });

  assert.equal(rows[0].patient_name, "หนึ่ง ทดสอบ");
  assert.equal(rows[0].age, 60);
  assert.equal(rows[1].patient_name, "สอง ทดสอบ");
  assert.equal(rows[1].age, 70);

  // ฟอร์มคัดกรองมีของ a2 คนเดียว ห้ามไปโผล่ที่ a1
  assert.equal(rows[0].screening, null);
  assert.equal(rows[1].screening?.screened_by, "พยาบาลบี");
});

test("ผู้ป่วยที่หาโปรไฟล์ไม่เจอ ต้องยังอยู่ในตาราง ไม่ใช่หายไปเงียบ ๆ", () => {
  const rows = assembleAppointments({
    appointments: [appt({ id: "a1", patient_id: "ไม่มีคนนี้" })],
    patients: [],
    doctors: [],
    assessments: [],
    notes: [],
  });

  assert.equal(rows.length, 1, "แถวหายไป = คนไข้ไม่ถูกเรียกตรวจโดยไม่มีใครรู้");
  assert.equal(rows[0].patient_name, null);
  assert.equal(rows[0].age, null);
});

test("ยังไม่คัดกรองและยังไม่บันทึกผล = null ไม่ใช่ค่าว่าง", () => {
  const [row] = assembleAppointments({
    appointments: [appt({})],
    patients: [patient("p1", "หนึ่ง", 60)],
    doctors: [],
    assessments: [],
    notes: [],
  });

  assert.equal(row.screening, null);
  assert.equal(row.doctor_note_at, null);
});

test("ถ้ามีฟอร์มซ้ำของนัดเดียวกัน ให้ใช้อันที่ส่งล่าสุด", () => {
  const [row] = assembleAppointments({
    appointments: [appt({})],
    patients: [patient("p1", "หนึ่ง", 60)],
    doctors: [],
    assessments: [
      assessment({ id: "เก่า", screened_by: "พยาบาลเก่า", submitted_at: "2026-08-24T01:00:00Z" }),
      assessment({ id: "ใหม่", screened_by: "พยาบาลใหม่", submitted_at: "2026-08-24T05:00:00Z" }),
    ],
    notes: [note({ id: "เก่า", created_at: "2026-08-24T01:00:00Z" }), note({ id: "ใหม่", created_at: "2026-08-24T09:00:00Z" })],
  });

  assert.equal(row.screening?.screened_by, "พยาบาลใหม่");
  assert.equal(row.doctor_note_at, "2026-08-24T09:00:00Z");
});

test("ชื่อแพทย์มาจาก doctor_id — ไม่มีหมอผูกไว้ต้องเป็น null", () => {
  const rows = assembleAppointments({
    appointments: [appt({ id: "a1", doctor_id: "d1" }), appt({ id: "a2", doctor_id: null })],
    patients: [patient("p1", "หนึ่ง", 60)],
    doctors: [{ id: "d1", first_name: "หมอ", last_name: "ใจดี" }],
    assessments: [],
    notes: [],
  });

  assert.equal(rows[0].doctor_name, "หมอ ใจดี");
  assert.equal(rows[1].doctor_name, null);
});

// ---------- การสร้างนัด ----------

/**
 * ทดสอบได้โดยไม่ต้องต่อฐานข้อมูล เพราะด่านสิทธิ์อยู่บรรทัดแรกของ service ก่อนจะไปแตะ
 * repository — ซึ่งเป็นลำดับที่ตั้งใจให้เป็นแบบนั้น ถ้าวันหนึ่งมีคนย้ายด่านนี้ลงไปอยู่หลัง
 * การอ่านฐานข้อมูล เทสนี้จะพังเพราะไปเรียก Supabase จริงแล้วค้าง ไม่ใช่ผ่านเงียบ ๆ
 */
const PATIENT = { sub: "11111111-1111-1111-1111-111111111111", role: "patient" } as const;
const CAREGIVER = { sub: "22222222-2222-2222-2222-222222222222", role: "caregiver" } as const;

const NEW_APPOINTMENT = {
  patient_id: "33333333-3333-3333-3333-333333333333",
  visit_date: "2026-08-28",
  visit_time: "09:30",
  visit_type: "routine",
  status: "scheduled",
} as const;

test("ผู้ป่วยสร้างนัดให้ตัวเองไม่ได้ — ต้องเป็นเจ้าหน้าที่คลินิก", async () => {
  await assert.rejects(
    () => create(PATIENT, { ...NEW_APPOINTMENT }),
    (err: ApiError) => err.statusCode === 403,
  );
});

test("ผู้ดูแลสร้างนัดไม่ได้", async () => {
  await assert.rejects(
    () => create(CAREGIVER, { ...NEW_APPOINTMENT }),
    (err: ApiError) => err.statusCode === 403,
  );
});

test("ผู้ป่วยเปลี่ยนสถานะนัดไม่ได้", async () => {
  await assert.rejects(
    () => updateStatus(PATIENT, "44444444-4444-4444-4444-444444444444", "completed"),
    (err: ApiError) => err.statusCode === 403,
  );
});

// ---------- การตรวจรูปแบบข้อมูลขาเข้า ----------

test("เวลาต้องเป็น HH:MM — รูปแบบอื่นถูกปฏิเสธ", () => {
  for (const bad of ["9:30", "09:30:00", "25:00", "09:60", "ไม่ใช่เวลา", ""]) {
    const result = createAppointmentSchema.safeParse({ ...NEW_APPOINTMENT, visit_time: bad });
    assert.equal(result.success, false, `"${bad}" ไม่ควรผ่าน`);
  }
  for (const ok of ["00:00", "09:30", "23:59"]) {
    const result = createAppointmentSchema.safeParse({ ...NEW_APPOINTMENT, visit_time: ok });
    assert.equal(result.success, true, `"${ok}" ควรผ่าน`);
  }
});

test("นัดที่ยังไม่ระบุเวลาสร้างได้ — คลินิกบางแห่งนัดเป็นช่วงเช้า/บ่าย", () => {
  assert.equal(createAppointmentSchema.safeParse({ ...NEW_APPOINTMENT, visit_time: null }).success, true);

  const noTime = { ...NEW_APPOINTMENT } as Record<string, unknown>;
  delete noTime.visit_time;
  assert.equal(createAppointmentSchema.safeParse(noTime).success, true);
});

test("ไม่ส่งสถานะมา ให้เป็น scheduled", () => {
  const noStatus = { ...NEW_APPOINTMENT } as Record<string, unknown>;
  delete noStatus.status;

  const result = createAppointmentSchema.safeParse(noStatus);
  assert.equal(result.success, true);
  assert.equal(result.success && result.data.status, "scheduled");
});

test("สร้างนัดด้วยสถานะ completed ไม่ได้ — เป็นผลของสิ่งที่เกิดทีหลัง ต้องมาทาง PATCH", () => {
  for (const bad of ["completed", "missed", "cancelled", "ไม่มีสถานะนี้"]) {
    const result = createAppointmentSchema.safeParse({ ...NEW_APPOINTMENT, status: bad });
    assert.equal(result.success, false, `"${bad}" ไม่ควรสร้างได้ตั้งแต่ต้น`);
  }
});

test("PATCH เปลี่ยนเป็น cancelled ได้ แต่ค่าที่ไม่มีใน enum ไม่ได้", () => {
  assert.equal(updateAppointmentStatusSchema.safeParse({ status: "cancelled" }).success, true);
  assert.equal(updateAppointmentStatusSchema.safeParse({ status: "deleted" }).success, false);
});

test("วันที่ที่ไม่มีจริงถูกปฏิเสธ", () => {
  for (const bad of ["2026-02-31", "2026-13-01", "28-08-2026", "2026/08/28"]) {
    const result = createAppointmentSchema.safeParse({ ...NEW_APPOINTMENT, visit_date: bad });
    assert.equal(result.success, false, `"${bad}" ไม่ควรผ่าน`);
  }
});
