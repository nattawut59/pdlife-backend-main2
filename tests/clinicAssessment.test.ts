import { test } from "node:test";
import assert from "node:assert/strict";
import { saveAssessmentSchema } from "../src/schemas/clinicAssessmentSchema";
import { getByAppointment, save } from "../src/services/clinicAssessmentService";
import { ASSESSMENT_ITEM_KEYS } from "../src/config/constants";
import { ApiError } from "../src/utils/ApiError";

/**
 * ฟอร์มคัดกรอง 26 ข้อ — สิ่งที่ต้องกันไว้คือฟอร์มไปผูกกับคนผิด และคนที่ไม่ใช่เจ้าหน้าที่
 * เขียนฟอร์มได้ ทั้งสองอย่างมองไม่เห็นจนกว่าแพทย์จะตรวจไปแล้ว
 *
 * เทสสิทธิ์ทำงานได้โดยไม่ต้องต่อฐานข้อมูล เพราะด่านตรวจสิทธิ์อยู่บรรทัดแรกของ service
 * ก่อนจะไปแตะ repository ถ้าวันหนึ่งมีคนย้ายด่านลงไปอยู่หลังการอ่านฐานข้อมูล เทสจะพัง
 * เพราะไปเรียก Supabase จริงแล้วค้าง ไม่ใช่ผ่านเงียบ ๆ
 */

const PATIENT = { sub: "11111111-1111-1111-1111-111111111111", role: "patient" } as const;
const CAREGIVER = { sub: "22222222-2222-2222-2222-222222222222", role: "caregiver" } as const;
const APPOINTMENT = "33333333-3333-3333-3333-333333333333";

const EMPTY_FORM = saveAssessmentSchema.parse({});

test("ผู้ป่วยอ่านฟอร์มคัดกรองไม่ได้", async () => {
  await assert.rejects(
    () => getByAppointment(PATIENT, APPOINTMENT),
    (err: ApiError) => err.statusCode === 403,
  );
});

test("ผู้ป่วยและผู้ดูแลบันทึกฟอร์มไม่ได้", async () => {
  for (const who of [PATIENT, CAREGIVER]) {
    await assert.rejects(
      () => save(who, APPOINTMENT, EMPTY_FORM),
      (err: ApiError) => err.statusCode === 403,
    );
  }
});

test("ส่ง patient_id เข้ามาเองไม่ได้ — service อ่านจากนัดหมายเท่านั้น", () => {
  const parsed = saveAssessmentSchema.parse({
    patient_id: "44444444-4444-4444-4444-444444444444",
    appointment_id: "55555555-5555-5555-5555-555555555555",
    nurse_id: "66666666-6666-6666-6666-666666666666",
  });

  // zod ตัดคีย์ที่ไม่ได้ประกาศทิ้ง จึงไม่มีทางหลุดไปถึงคำสั่งเขียนฐานข้อมูล
  assert.equal("patient_id" in parsed, false);
  assert.equal("appointment_id" in parsed, false);
  assert.equal("nurse_id" in parsed, false);
});

test("ไม่ติ๊กอะไรเลย = ไม่พบอาการทั้ง 26 ข้อ ไม่ใช่ค่าว่าง", () => {
  assert.equal(ASSESSMENT_ITEM_KEYS.length, 26, "ฟอร์มกระดาษมี 26 ข้อ");

  for (const key of ASSESSMENT_ITEM_KEYS) {
    assert.equal(
      EMPTY_FORM[key],
      false,
      `${key} ต้องเป็น false ไม่ใช่ undefined — ไม่งั้นคอลัมน์จะถูกเขียนเป็น null ` +
        "ซึ่งอ่านได้ว่า 'ไม่ได้ถาม' แทนที่จะเป็น 'ถามแล้วไม่พบ'",
    );
  }
  assert.equal(EMPTY_FORM.has_caregiver, false);
});

test("สถานะเริ่มต้นเป็นร่าง และตั้งเป็น doctor_opened เองไม่ได้", () => {
  assert.equal(EMPTY_FORM.status, "draft");
  assert.equal(saveAssessmentSchema.safeParse({ status: "submitted" }).success, true);

  // แพทย์เปิดอ่านเป็นสิ่งที่เกิดขึ้นตอนแพทย์เปิด ไม่ใช่สิ่งที่พยาบาลตั้งได้
  assert.equal(saveAssessmentSchema.safeParse({ status: "doctor_opened" }).success, false);
  assert.equal(saveAssessmentSchema.safeParse({ status: "ส่งแล้ว" }).success, false);
});

test("ชื่อผู้คัดกรองเว้นว่างได้ — service เติมชื่อเจ้าของบัญชีให้", () => {
  assert.equal(saveAssessmentSchema.safeParse({}).success, true);
  assert.equal(saveAssessmentSchema.safeParse({ screened_by: null }).success, true);
  assert.equal(
    saveAssessmentSchema.safeParse({ screened_by: "พยาบาลกาญจนา ดวงแก้ว" }).success,
    true,
  );
});

test("หมายเหตุยาวเกินไปถูกปฏิเสธ ไม่ใช่ตัดทิ้งเงียบ ๆ", () => {
  assert.equal(saveAssessmentSchema.safeParse({ other_note: "ก".repeat(2000) }).success, true);
  assert.equal(saveAssessmentSchema.safeParse({ other_note: "ก".repeat(2001) }).success, false);
});

test("ค่าที่ไม่ใช่ boolean ในช่องอาการถูกปฏิเสธ", () => {
  for (const bad of ["true", 1, "ใช่", null]) {
    const result = saveAssessmentSchema.safeParse({ motor_tremor: bad });
    assert.equal(result.success, false, `motor_tremor = ${JSON.stringify(bad)} ไม่ควรผ่าน`);
  }
});
