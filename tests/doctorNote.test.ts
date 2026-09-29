import { test } from "node:test";
import assert from "node:assert/strict";
import { saveDoctorNoteSchema } from "../src/schemas/doctorNoteSchema";
import { getByAppointment, save } from "../src/services/doctorNoteService";
import { markOpened } from "../src/services/clinicAssessmentService";
import { ApiError } from "../src/utils/ApiError";

/**
 * บันทึกผลการตรวจเป็นความเห็นทางการแพทย์ที่มีการปรับยาอยู่ข้างใน สิ่งที่ต้องกันคือคนที่
 * ไม่ใช่แพทย์เขียนมันได้ และการปรับยาที่ไม่มีเหตุผลกำกับ — อย่างหลังไม่ใช่เรื่องความสะดวก
 * ของฟอร์ม แต่เป็นความถูกต้องของเวชระเบียนที่ต้องบังคับที่ API ด้วย ไม่ใช่แค่ที่หน้าจอ
 *
 * เทสสิทธิ์ทำงานได้โดยไม่ต้องต่อฐานข้อมูล เพราะด่านตรวจสิทธิ์อยู่บรรทัดแรกของ service
 * ก่อนจะไปแตะ repository
 */

const PATIENT = { sub: "11111111-1111-1111-1111-111111111111", role: "patient" } as const;
const CAREGIVER = { sub: "22222222-2222-2222-2222-222222222222", role: "caregiver" } as const;
const NURSE = { sub: "33333333-3333-3333-3333-333333333333", role: "nurse" } as const;
const APPOINTMENT = "44444444-4444-4444-4444-444444444444";

const EMPTY_NOTE = saveDoctorNoteSchema.parse({});

test("พยาบาลเขียนบันทึกผลการตรวจไม่ได้ — เป็นความเห็นทางการแพทย์", async () => {
  await assert.rejects(
    () => save(NURSE, APPOINTMENT, EMPTY_NOTE),
    (err: ApiError) => err.statusCode === 403,
  );
});

test("ผู้ป่วยและผู้ดูแลเขียนไม่ได้", async () => {
  for (const who of [PATIENT, CAREGIVER]) {
    await assert.rejects(
      () => save(who, APPOINTMENT, EMPTY_NOTE),
      (err: ApiError) => err.statusCode === 403,
    );
  }
});

test("พยาบาลอ่านบันทึกได้ — ต้องรู้แผนการรักษาเพื่อทำงานต่อ", async () => {
  // ไม่ควรถูกปฏิเสธที่ด่านสิทธิ์ — จะไปพังที่การต่อฐานข้อมูลแทน ซึ่งเป็นคนละเรื่อง
  await assert.rejects(
    () => getByAppointment(NURSE, APPOINTMENT),
    (err: ApiError) => err.statusCode !== 403,
  );
});

test("ผู้ป่วยอ่านบันทึกไม่ได้", async () => {
  await assert.rejects(
    () => getByAppointment(PATIENT, APPOINTMENT),
    (err: ApiError) => err.statusCode === 403,
  );
});

test("พยาบาลเปิดดูฟอร์มไม่นับว่าแพทย์อ่านแล้ว", async () => {
  // คืน null เงียบ ๆ ไม่ใช่ 403 — หน้าจอเดียวกันถูกเปิดโดยทั้งสองบทบาท
  assert.equal(await markOpened(NURSE, APPOINTMENT), null);
  assert.equal(await markOpened(PATIENT, APPOINTMENT), null);
});

// ---------- ความถูกต้องของเวชระเบียน ----------

test("ปรับยาโดยไม่ระบุเหตุผล ต้องถูกปฏิเสธที่ API ไม่ใช่แค่ที่หน้าจอ", () => {
  for (const reason of [undefined, null, "", "   "]) {
    const result = saveDoctorNoteSchema.safeParse({
      medication_adjustment: true,
      reason_for_change: reason,
    });
    assert.equal(
      result.success,
      false,
      `ปรับยาโดยเหตุผลเป็น ${JSON.stringify(reason)} ไม่ควรผ่าน`,
    );
  }

  assert.equal(
    saveDoctorNoteSchema.safeParse({
      medication_adjustment: true,
      reason_for_change: "เพิ่มความถี่ Levodopa จาก 3 เป็น 4 มื้อ เพราะยาหมดฤทธิ์ก่อนมื้อถัดไป",
    }).success,
    true,
  );
});

test("ไม่ปรับยา ไม่ต้องมีเหตุผล", () => {
  assert.equal(saveDoctorNoteSchema.safeParse({ medication_adjustment: false }).success, true);
  assert.equal(EMPTY_NOTE.medication_adjustment, false, "ไม่ส่งมา = ไม่ได้ปรับยา");
});

test("ความเร่งด่วนรับเฉพาะค่าที่ฐานข้อมูลมี", () => {
  for (const ok of ["routine", "soon", "urgent", null]) {
    assert.equal(saveDoctorNoteSchema.safeParse({ follow_up_urgency: ok }).success, true);
  }
  assert.equal(saveDoctorNoteSchema.safeParse({ follow_up_urgency: "ด่วน" }).success, false);
});

test("วันนัดถัดไปที่ไม่มีจริงถูกปฏิเสธ", () => {
  assert.equal(saveDoctorNoteSchema.safeParse({ next_appointment_date: "2026-09-28" }).success, true);
  assert.equal(saveDoctorNoteSchema.safeParse({ next_appointment_date: null }).success, true);
  for (const bad of ["2026-02-31", "28-09-2026", "เร็ว ๆ นี้"]) {
    assert.equal(saveDoctorNoteSchema.safeParse({ next_appointment_date: bad }).success, false);
  }
});

test("ส่ง doctor_id หรือ appointment_id เข้ามาเองไม่ได้", () => {
  const parsed = saveDoctorNoteSchema.parse({
    doctor_id: "55555555-5555-5555-5555-555555555555",
    appointment_id: "66666666-6666-6666-6666-666666666666",
    assessment_id: "77777777-7777-7777-7777-777777777777",
  });

  for (const key of ["doctor_id", "appointment_id", "assessment_id"]) {
    assert.equal(key in parsed, false, `${key} ต้องไม่หลุดไปถึงคำสั่งเขียนฐานข้อมูล`);
  }
});
