import { test } from "node:test";
import assert from "node:assert/strict";
import { groupCountsByDate } from "../src/services/appointmentService";
import { listAppointmentCountsQuerySchema } from "../src/schemas/appointmentSchema";

/**
 * จำนวนนัดต่อวัน — ใช้วาดจุดบนปฏิทินสัปดาห์ของหน้าตารางนัด
 *
 * ตัวเลขนี้ต้องเท่ากับจำนวนแถวที่เห็นจริงตอนกดเข้าไปดูวันนั้น (listByDate ไม่กรองสถานะ
 * ฝั่งนับก็ต้องไม่กรอง) ไม่งั้นจะกลายเป็น "จุดบอกว่ามี 5 แต่เปิดมาเห็น 3"
 */

test("groupCountsByDate: นัดหลายใบในวันเดียวกันต้องรวมเป็นตัวเลขเดียว", () => {
  const result = groupCountsByDate(["2026-09-08", "2026-09-08", "2026-09-08"]);
  assert.deepEqual(result, [{ date: "2026-09-08", total: 3 }]);
});

test("groupCountsByDate: คนละวันต้องแยกกัน และเรียงตามวันที่", () => {
  const result = groupCountsByDate(["2026-09-10", "2026-09-08", "2026-09-10"]);
  assert.deepEqual(result, [
    { date: "2026-09-08", total: 1 },
    { date: "2026-09-10", total: 2 },
  ]);
});

test("groupCountsByDate: วันที่ไม่มีนัดต้องไม่โผล่มาเป็น 0 (คืนแบบ sparse)", () => {
  const result = groupCountsByDate(["2026-09-08", "2026-09-10"]);
  assert.equal(result.length, 2, "ไม่ควรเติมวันที่ 9 ที่ไม่มีนัดเข้ามา");
  assert.ok(!result.some((r) => r.date === "2026-09-09"));
});

test("groupCountsByDate: ช่วงที่ไม่มีนัดเลยต้องได้ array ว่าง ไม่ใช่พัง", () => {
  assert.deepEqual(groupCountsByDate([]), []);
});

// ---------- เพดานช่วงวันที่ ----------

test("counts query: ช่วงปกติ (หนึ่งสัปดาห์) ต้องผ่าน", () => {
  const parsed = listAppointmentCountsQuerySchema.parse({ from: "2026-09-06", to: "2026-09-12" });
  assert.equal(parsed.from, "2026-09-06");
});

test("counts query: ช่วงยาวเกินหนึ่งเดือนต้องถูกปฏิเสธ ไม่ปล่อยให้กวาดทั้งปี", () => {
  assert.throws(() => listAppointmentCountsQuerySchema.parse({ from: "2026-01-01", to: "2026-12-31" }));
});

test("counts query: from มาหลัง to ต้องถูกปฏิเสธ ไม่ใช่คืนค่าว่างเงียบ ๆ", () => {
  assert.throws(() => listAppointmentCountsQuerySchema.parse({ from: "2026-09-12", to: "2026-09-06" }));
});

test("counts query: ต้องบังคับให้ส่งทั้ง from และ to", () => {
  assert.throws(() => listAppointmentCountsQuerySchema.parse({ from: "2026-09-06" }));
  assert.throws(() => listAppointmentCountsQuerySchema.parse({}));
});
