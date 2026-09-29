import { test } from "node:test";
import assert from "node:assert/strict";
import { composeMedicationReminder, doseForTime } from "../src/services/schedulerService";

/**
 * ข้อความแจ้งเตือนกินยา — เดิมส่งข้อความเดียวกันหมดทุกตัวยา
 *
 * ผู้ป่วยที่กินยา 4 ตัว 8 มื้อต่อวันเห็นแจ้งเตือนหน้าตาเหมือนกันเป๊ะทั้งวัน แยกไม่ออกว่าอันไหน
 * ของยาตัวไหน เทสชุดนี้ล็อกไว้ว่าชื่อยาและขนาดต้องไปถึงหน้าจอผู้ป่วยจริง
 */

// ---------- doseForTime: กับดักรูปแบบเวลาที่โปรเจกต์นี้เคยโดนมาแล้วสองรอบ ----------

test("doseForTime: คีย์ตรงกันเป๊ะ", () => {
  assert.equal(doseForTime({ "08:00": "1 เม็ด" }, "08:00"), "1 เม็ด");
});

test("doseForTime: scheduled_times มาเป็น HH:MM:SS แต่ doses เก็บคีย์เป็น HH:MM", () => {
  // คอลัมน์ TIME[] ของ Postgres ส่งกลับเป็น HH:MM:SS เสมอ ส่วน doses เป็น JSON ที่เว็บตั้งคีย์เอง
  assert.equal(doseForTime({ "08:00": "1 เม็ด" }, "08:00:00"), "1 เม็ด");
});

test("doseForTime: กลับกัน — doses เก็บ HH:MM:SS แต่ค้นด้วย HH:MM", () => {
  assert.equal(doseForTime({ "08:00:00": "2 เม็ด" }, "08:00"), "2 เม็ด");
});

test("doseForTime: ไม่มีขนาดยาของมื้อนั้นต้องได้ null ไม่ใช่ undefined หรือพัง", () => {
  assert.equal(doseForTime({ "08:00": "1 เม็ด" }, "12:00"), null);
  assert.equal(doseForTime({}, "08:00"), null);
});

// ---------- composeMedicationReminder ----------

const MED = { drug_name: "Levodopa/Carbidopa", drug_thai_name: "ลีโวโดปา/คาร์บิโดปา" };

test("composeMedicationReminder: บอกชื่อยาและขนาดยา", () => {
  const msg = composeMedicationReminder(MED, "1 เม็ด");
  assert.equal(msg.title, "ถึงเวลากินยา ลีโวโดปา/คาร์บิโดปา");
  assert.match(msg.body, /^1 เม็ด · /);
});

test("composeMedicationReminder: ไม่มีชื่อไทยให้ใช้ชื่อสามัญแทน ไม่ใช่ค่าว่าง", () => {
  const msg = composeMedicationReminder({ drug_name: "Rasagiline", drug_thai_name: null }, "1 เม็ด");
  assert.equal(msg.title, "ถึงเวลากินยา Rasagiline");
});

test("composeMedicationReminder: ชื่อไทยเป็นช่องว่างล้วนก็ต้องถอยไปใช้ชื่อสามัญ", () => {
  const msg = composeMedicationReminder({ drug_name: "Rasagiline", drug_thai_name: "   " }, null);
  assert.equal(msg.title, "ถึงเวลากินยา Rasagiline");
});

test("composeMedicationReminder: ไม่รู้ขนาดยา ยังต้องเตือนได้ ไม่โชว์คำว่า null", () => {
  const msg = composeMedicationReminder(MED, null);
  assert.equal(msg.title, "ถึงเวลากินยา ลีโวโดปา/คาร์บิโดปา");
  assert.ok(!/null|undefined/.test(msg.body), "ห้ามให้ค่าว่างหลุดไปโผล่บนหน้าจอผู้ป่วย");
});

test("composeMedicationReminder: หายาใน catalog ไม่เจอ ต้องยังเตือนด้วยข้อความเดิม", () => {
  // คนไข้ไม่ควรพลาดยาเพราะข้อมูลฝั่งเราหาย — ห้ามข้ามหรือโยน error
  const msg = composeMedicationReminder(null, "1 เม็ด");
  assert.equal(msg.title, "ถึงเวลากินยา");
  assert.ok(msg.body.length > 0);
});
