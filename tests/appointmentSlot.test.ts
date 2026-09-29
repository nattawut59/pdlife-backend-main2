import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidSlotTime,
  createAppointmentSchema,
  createSelfAppointmentSchema,
  generateSlotGrid,
} from "../src/schemas/appointmentSchema";
import { computeAvailableSlots } from "../src/services/appointmentService";

// ---------- isValidSlotTime: ตรง slot boundary (ทุก 30 นาที) และอยู่ในเวลาทำการ 08:00-17:00 ----------

test("isValidSlotTime: เวลาที่ตรง slot boundary พอดีผ่าน", () => {
  assert.equal(isValidSlotTime("08:00"), true);
  assert.equal(isValidSlotTime("08:30"), true);
  assert.equal(isValidSlotTime("16:30"), true);
});

test("isValidSlotTime: เวลาที่ไม่ตรง slot boundary ไม่ผ่าน", () => {
  assert.equal(isValidSlotTime("08:15"), false);
  assert.equal(isValidSlotTime("09:05"), false);
});

test("isValidSlotTime: นอกเวลาทำการไม่ผ่าน แม้ตรง slot boundary", () => {
  assert.equal(isValidSlotTime("07:30"), false); // ก่อนเปิด
  assert.equal(isValidSlotTime("17:00"), false); // ปิดพอดี — ไม่รวมนาทีปิด
  assert.equal(isValidSlotTime("17:30"), false); // หลังปิด
});

// ---------- createAppointmentSchema: ตรวจ slot เฉพาะเมื่อมี doctor_id ----------

const BASE = {
  patient_id: "11111111-1111-1111-1111-111111111111",
  visit_date: "2026-09-10",
  visit_type: "follow_up" as const,
};

test("createAppointmentSchema: ไม่มี doctor_id ไม่บังคับตรง slot เลย", () => {
  const result = createAppointmentSchema.safeParse({ ...BASE, visit_time: "08:15" });
  assert.equal(result.success, true);
});

test("createAppointmentSchema: มี doctor_id + เวลาไม่ตรง slot ต้องถูกปฏิเสธ", () => {
  const result = createAppointmentSchema.safeParse({
    ...BASE,
    doctor_id: "22222222-2222-2222-2222-222222222222",
    visit_time: "08:15",
  });
  assert.equal(result.success, false);
});

test("createAppointmentSchema: มี doctor_id + เวลาตรง slot และในเวลาทำการ ผ่าน", () => {
  const result = createAppointmentSchema.safeParse({
    ...BASE,
    doctor_id: "22222222-2222-2222-2222-222222222222",
    visit_time: "08:30",
  });
  assert.equal(result.success, true);
});

test("createAppointmentSchema: มี doctor_id แต่ไม่ระบุ visit_time ผ่านได้ (ยังไม่รู้เวลา)", () => {
  const result = createAppointmentSchema.safeParse({
    ...BASE,
    doctor_id: "22222222-2222-2222-2222-222222222222",
  });
  assert.equal(result.success, true);
});

// ---------- generateSlotGrid / computeAvailableSlots ----------

test("generateSlotGrid: ครบทุกช่องตั้งแต่เปิดถึงก่อนปิด ไม่รวมนาทีปิด", () => {
  const grid = generateSlotGrid();
  assert.equal(grid[0], "08:00");
  assert.equal(grid[grid.length - 1], "16:30");
  assert.equal(grid.includes("17:00"), false);
  assert.equal(grid.length, 18); // (17:00-08:00)/30นาที = 18 ช่อง
});

test("computeAvailableSlots: ไม่มีใครจองเลย -> ทุกช่องว่าง", () => {
  const slots = computeAvailableSlots([]);
  assert.equal(slots.every((s) => s.available), true);
  assert.equal(slots.length, generateSlotGrid().length);
});

test("computeAvailableSlots: รับแค่รูปแบบ \"HH:MM\" เท่านั้น — ผู้เรียกต้องตัดวินาทีทิ้งเอง", () => {
  // เจอบั๊กจริงตอนรัน smoke test: appointmentRepository ส่ง "08:00:00" (TIME column ดิบจาก
  // Postgres) มาไม่ตัดวินาที ทำให้ Set.has() ไม่ตรงกับ generateSlotGrid() เลยสักช่อง —
  // available-slots ที่ได้จะขึ้นว่างหมดเสมอไม่ว่าจองไปกี่ช่องแล้วก็ตาม เทสนี้ล็อกสัญญาที่ว่า
  // computeAvailableSlots ไม่ใช่คนตัดวินาทีให้ — repository ต้องทำเองก่อนส่งเข้ามา (ดู
  // appointmentRepository.listByDoctorAndDate)
  const slots = computeAvailableSlots(["08:00:00"]);
  const byTime = new Map(slots.map((s) => [s.time, s.available]));
  assert.equal(byTime.get("08:00"), true, "\"08:00:00\" ไม่ตัดวินาทีเองแล้วต้องไม่ตรงกับ \"08:00\"");
});

test("computeAvailableSlots: จองไปบางช่อง -> เฉพาะช่องนั้น unavailable", () => {
  const slots = computeAvailableSlots(["08:30", "10:00"]);
  const byTime = new Map(slots.map((s) => [s.time, s.available]));
  assert.equal(byTime.get("08:30"), false);
  assert.equal(byTime.get("10:00"), false);
  assert.equal(byTime.get("08:00"), true);
  assert.equal(byTime.get("09:30"), true);
});

// ---------- createSelfAppointmentSchema: กติกาเข้มกว่าฟอร์มของ staff ----------

const SELF_BASE = {
  doctor_id: "22222222-2222-2222-2222-222222222222",
  visit_type: "follow_up" as const,
};

test("createSelfAppointmentSchema: วันเวลาถูกต้อง อนาคต ผ่าน", () => {
  const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const result = createSelfAppointmentSchema.safeParse({
    ...SELF_BASE,
    visit_date: farFuture,
    visit_time: "09:00",
  });
  assert.equal(result.success, true);
});

test("createSelfAppointmentSchema: จองย้อนหลังถูกปฏิเสธ", () => {
  const result = createSelfAppointmentSchema.safeParse({
    ...SELF_BASE,
    visit_date: "2020-01-01",
    visit_time: "09:00",
  });
  assert.equal(result.success, false);
});

test("createSelfAppointmentSchema: เวลาไม่ตรง slot boundary ถูกปฏิเสธ", () => {
  const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const result = createSelfAppointmentSchema.safeParse({
    ...SELF_BASE,
    visit_date: farFuture,
    visit_time: "09:15",
  });
  assert.equal(result.success, false);
});

test("createSelfAppointmentSchema: visit_type urgent/walk_in จองเองไม่ได้", () => {
  const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const urgent = createSelfAppointmentSchema.safeParse({
    ...SELF_BASE,
    visit_date: farFuture,
    visit_time: "09:00",
    visit_type: "urgent",
  });
  const walkIn = createSelfAppointmentSchema.safeParse({
    ...SELF_BASE,
    visit_date: farFuture,
    visit_time: "09:00",
    visit_type: "walk_in",
  });
  assert.equal(urgent.success, false);
  assert.equal(walkIn.success, false);
});

test("createSelfAppointmentSchema: doctor_id บังคับเสมอ ไม่มี 'ไว้ค่อยจัด'", () => {
  const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const { doctor_id, ...withoutDoctor } = SELF_BASE;
  const result = createSelfAppointmentSchema.safeParse({
    ...withoutDoctor,
    visit_date: farFuture,
    visit_time: "09:00",
  });
  assert.equal(result.success, false);
});
