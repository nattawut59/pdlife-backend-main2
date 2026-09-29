import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByPatient } from "../src/repositories/dashboardRepository";
import { adherenceFrom } from "../src/services/dashboardService";
import type { MedicationLogRow } from "../src/types/database";

/**
 * หน้าทะเบียนผู้ป่วยดึงข้อมูลของทุกคนมาในคำขอเดียวแล้วแยกกลุ่มเอง แทนที่จะยิง endpoint
 * รายคนทีละคน (เดิม 50 คน = 151 คำขอ) การแยกกลุ่มผิดพลาดจึงหมายถึง **ข้อมูลของผู้ป่วย
 * คนหนึ่งไปโผล่ในแถวของอีกคน** ซึ่งร้ายแรงกว่าหน้าช้ามาก
 */

const log = (over: Partial<MedicationLogRow>): MedicationLogRow =>
  ({ id: "l", patient_id: "p1", status: "taken", late_minutes: null, ...over }) as MedicationLogRow;

test("groupByPatient: แต่ละแถวเข้ากลุ่มของเจ้าของเท่านั้น", () => {
  const rows = [
    { patient_id: "a", v: 1 },
    { patient_id: "b", v: 2 },
    { patient_id: "a", v: 3 },
  ];
  const map = groupByPatient(rows, ["a", "b"]);
  assert.deepEqual(map.get("a")?.map((r) => r.v), [1, 3]);
  assert.deepEqual(map.get("b")?.map((r) => r.v), [2]);
});

test("groupByPatient: ผู้ป่วยที่ไม่มีข้อมูลต้องได้ array ว่าง ไม่ใช่ undefined", () => {
  // ถ้าคืน undefined แล้วโค้ดปลายทางเผลอใช้ ?? [] ไม่ครบ ผู้ป่วยที่ยังไม่เคยบันทึกจะหาย
  // ไปจากทะเบียนทั้งแถว แทนที่จะขึ้นว่ายังไม่มีข้อมูล
  const map = groupByPatient([{ patient_id: "a" }], ["a", "b", "c"]);
  assert.deepEqual(map.get("b"), []);
  assert.deepEqual(map.get("c"), []);
});

test("groupByPatient: แถวของคนที่ไม่ได้อยู่ในรายการต้องไม่ถูกยัดเข้ากลุ่มไหน", () => {
  const map = groupByPatient([{ patient_id: "ghost" }, { patient_id: "a" }], ["a"]);
  assert.equal(map.size, 1);
  assert.equal(map.get("a")?.length, 1);
});

test("adherenceFrom: นับเฉพาะมื้อที่รู้ผลแล้ว", () => {
  // pending = ยังไม่ถึงเวลา ไม่ใช่ "ไม่ได้กิน" — เอามานับจะทำให้ % ตรงเวลาต่ำเกินจริงตลอด
  const counts = adherenceFrom([
    log({ status: "taken" }),
    log({ status: "taken" }),
    log({ status: "skipped" }),
    log({ status: "pending" }),
  ]);
  assert.deepEqual(counts, { taken: 2, skipped: 1, total: 3 });
});

test("adherenceFrom: ไม่มีมื้อที่รู้ผลเลย -> total 0 (ปลายทางจะได้คืน null ไม่ใช่ 0%)", () => {
  assert.deepEqual(adherenceFrom([log({ status: "pending" })]), { taken: 0, skipped: 0, total: 0 });
});
