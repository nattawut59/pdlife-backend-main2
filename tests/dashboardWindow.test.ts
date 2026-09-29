import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ช่วงเวลาที่จบ "ตอนนี้" ต้องไม่มีขอบบน
 *
 * คอลัมน์เวลาทุกตัวที่ dashboard และ red_flags กรอง (ts / answered_at / occurred_at /
 * planned_at / created_at) ถูกประทับด้วย DEFAULT now() คือนาฬิกาของ Postgres ส่วนค่าที่เรา
 * ส่งไปเทียบคำนวณจากนาฬิกาของเครื่องที่รันแอป สองนาฬิกานี้ไม่มีทางตรงกันเป๊ะ
 *
 * ถ้านาฬิกาฐานข้อมูลเร็วกว่า แถวที่เพิ่งเขียนจะดูเหมือนอยู่ในอนาคตและถูกขอบบนกรองทิ้ง
 * เคยเกิดขึ้นจริงตอนเครื่องช้ากว่าฐานข้อมูล 90 วินาที: ผู้ป่วยตอบว่าคิดทำร้ายตัวเอง
 * ธงถูกเขียนลงฐานข้อมูลถูกต้องทุกอย่าง แต่หมอเปิดดูแล้วเห็น 0 รายการ
 *
 * เทสต์นี้อ่านโค้ดจริงเพื่อกันไม่ให้ใครเผลอใส่ .lte() กลับเข้าไป — ไม่ใช่การทดสอบพฤติกรรม
 * แต่บั๊กนี้เงียบเกินกว่าจะปล่อยให้กลับมาได้โดยไม่มีอะไรเตือน
 */

// รากของแพ็กเกจ — node:test ถูกเรียกผ่าน npm test เสมอ ซึ่งรันจากโฟลเดอร์นี้
//
// ไม่ใช้ import.meta.url เพราะโปรเจกต์นี้เป็น CommonJS (package.json ไม่ได้ตั้ง type: module)
// ไวยากรณ์นั้นเป็นของ ESM ล้วน tsc จึงปฏิเสธ ที่ผ่านมารันได้เพราะ tsx ผ่อนปรนให้เฉย ๆ
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, "src", p), "utf8");

test("dashboardRepository ไม่ผูก .lte() กับคอลัมน์เวลาโดยตรง", () => {
  const src = read("repositories/dashboardRepository.ts");
  const direct = [...src.matchAll(/\.lte\("(ts|answered_at|occurred_at|planned_at)"/g)].map((m) => m[1]);
  assert.deepEqual(
    direct,
    [],
    `คอลัมน์ ${direct.join(", ")} ถูกกรองด้วย .lte() ตรง ๆ — ต้องผ่าน upTo() เพื่อให้ช่วงที่จบ ` +
      `"ตอนนี้" ข้ามขอบบนได้ ไม่งั้นแถวใหม่ล่าสุดจะหายเมื่อนาฬิกาสองฝั่งเหลื่อมกัน`
  );
});

test("redFlagRepository ไม่ใส่ขอบบนให้ created_at", () => {
  const src = read("repositories/redFlagRepository.ts");
  assert.ok(
    !src.includes('.lte("created_at"'),
    'red_flags ถูกกรองด้วยขอบบน — ธง urgent ที่เพิ่งยิงจะหายไปจากหน้าจอหมอเมื่อนาฬิกาเหลื่อมกัน'
  );
});

test("windowFor คืนขอบบนเป็น null เมื่อช่วงจบที่ปัจจุบัน", () => {
  const src = read("services/dashboardService.ts");
  assert.match(
    src,
    /toIso:\s*endDate === undefined \? null : to\.toISOString\(\)/,
    "windowFor ต้องคืน null เมื่อไม่ได้ระบุ endDate — ช่วงที่จบ 'ตอนนี้' ไม่ควรมีขอบบน"
  );
});

test("visit-comparison ยังส่ง endDate อยู่ — ช่วงในอดีตต้องมีขอบบน", () => {
  const src = read("services/dashboardService.ts");
  const withEndDate = [...src.matchAll(/windowFor\(7, new Date\(/g)];
  assert.equal(
    withEndDate.length,
    2,
    "เทียบก่อน/หลังวันนัดต้องเรียก windowFor พร้อม endDate ทั้งสองครั้ง เพราะเป็นช่วงเวลาในอดีตจริง"
  );
});
