import { test } from "node:test";
import assert from "node:assert/strict";
import { addMinutes, appWeekday, dateOnly, endOfDay, endOfAppDate, isWithin, todayAt } from "../src/utils/datetime";

/**
 * เวลาทุกค่าที่ผู้ป่วยและหมอกรอก (wake_time, sleep_time, scheduled_times ของยา) เป็นเวลาไทย
 * เทสต์ชุดนี้จึงยืนยันว่าฟังก์ชันตีความเป็นเวลาไทย ไม่ใช่ UTC — ไทยเป็น UTC+7 คงที่ ไม่มี DST
 */

test("todayAt: ตีความเวลาที่ให้มาเป็นเวลาไทย", () => {
  const base = new Date("2026-07-24T10:00:00.000Z"); // = 17:00 เวลาไทย วันที่ 24
  // 07:30 เวลาไทย = 00:30 UTC ของวันเดียวกัน
  assert.equal(todayAt("07:30", base).toISOString(), "2026-07-24T00:30:00.000Z");
});

test("todayAt: รับรูปแบบ HH:MM:SS ด้วย", () => {
  const base = new Date("2026-07-24T10:00:00.000Z");
  assert.equal(todayAt("07:30:15", base).toISOString(), "2026-07-24T00:30:15.000Z");
});

test("todayAt: เวลานอนสามทุ่มครึ่งต้องได้สามทุ่มครึ่งเวลาไทย", () => {
  // เคสที่บั๊กเดิมทำผิด: เดิมได้ 21:30 UTC ซึ่งคือตี 4 ครึ่งเวลาไทย
  const base = new Date("2026-07-24T10:00:00.000Z");
  const sleepAt = todayAt("21:30", base);
  assert.equal(sleepAt.toISOString(), "2026-07-24T14:30:00.000Z");
  assert.equal(sleepAt.getTime() + 7 * 60 * 60_000, new Date("2026-07-24T21:30:00.000Z").getTime());
});

test("addMinutes: บวกลบนาที ไม่เกี่ยวกับ timezone", () => {
  const base = new Date("2026-07-24T07:30:00.000Z");
  assert.equal(addMinutes(base, 30).toISOString(), "2026-07-24T08:00:00.000Z");
  assert.equal(addMinutes(base, -30).toISOString(), "2026-07-24T07:00:00.000Z");
});

test("isWithin: ช่วงแบบ [start, end)", () => {
  const start = new Date("2026-07-24T07:00:00.000Z");
  const end = new Date("2026-07-24T08:00:00.000Z");
  assert.equal(isWithin(start, start, end), true, "รวมจุดเริ่ม");
  assert.equal(isWithin(end, start, end), false, "ไม่รวมจุดจบ");
  assert.equal(isWithin(new Date("2026-07-24T07:30:00.000Z"), start, end), true);
  assert.equal(isWithin(new Date("2026-07-24T06:59:00.000Z"), start, end), false);
});

test("dateOnly: คืนวันที่ตามปฏิทินไทย", () => {
  // 23:59:59 UTC = 06:59 เวลาไทยของวันถัดไป
  assert.equal(dateOnly(new Date("2026-07-24T23:59:59.000Z")), "2026-07-25");
});

test("dateOnly: เคสขอบที่บั๊กเดิมทำผิด — ตี 1 เวลาไทยยังนับเป็นวันใหม่", () => {
  // 18:00 UTC วันที่ 24 = 01:00 เวลาไทย วันที่ 25
  // เดิมคืน "2026-07-24" ทำให้ round ทั้งวันถูกผูกกับวันผิด
  assert.equal(dateOnly(new Date("2026-07-24T18:00:00.000Z")), "2026-07-25");
  // 16:59 UTC = 23:59 เวลาไทยของวันที่ 24 — ยังต้องเป็นวันที่ 24
  assert.equal(dateOnly(new Date("2026-07-24T16:59:00.000Z")), "2026-07-24");
});

test("endOfDay: สิ้นวันตามปฏิทินไทย ไม่ใช่สิ้นวัน UTC", () => {
  const base = new Date("2026-07-24T10:00:00.000Z"); // 17:00 เวลาไทย วันที่ 24
  // 23:59:59.999 เวลาไทย วันที่ 24 = 16:59:59.999 UTC
  assert.equal(endOfDay(base).toISOString(), "2026-07-24T16:59:59.999Z");
});

test("appWeekday: วันในสัปดาห์ตามปฏิทินไทย (1=จันทร์ .. 7=อาทิตย์)", () => {
  // 2026-07-24 เป็นวันศุกร์
  assert.equal(appWeekday(new Date("2026-07-24T10:00:00.000Z")), 5, "ศุกร์");
  // 18:00 UTC ศุกร์ = ตี 1 ของวันเสาร์เวลาไทย — เดิมยังตอบว่าศุกร์
  assert.equal(appWeekday(new Date("2026-07-24T18:00:00.000Z")), 6, "เสาร์");
});

test("explicit Bangkok end-of-date boundary does not use UTC midnight", () => {
  assert.equal(endOfAppDate("2026-09-28").toISOString(), "2026-09-28T16:59:59.999Z");
});
