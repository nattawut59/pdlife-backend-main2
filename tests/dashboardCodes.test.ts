import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * กันไม่ให้โค้ดกับคลังคำถามหลุดจากกันเงียบๆ
 *
 * dashboardService นับ "การล้ม" จากคำตอบทุกข้อที่ไม่ใช่รหัสที่แปลว่าไม่เกิดเหตุ ซึ่งแปลว่ามัน
 * ผูกกับรหัสตัวเลือกที่มาจากไฟล์ Excel โดยตรง ถ้าวันหนึ่งมีคนแก้รหัสใน Excel แล้ว regenerate
 * แต่ไม่ได้แก้โค้ด จะไม่มี error ไม่มีเทสต์แดง — มีแต่ตัวเลขบน dashboard ของหมอที่ผิด
 * (ผู้ป่วยที่ตอบว่าไม่ได้ล้ม จะถูกนับเป็นล้มทุกคน) ซึ่งอันตรายกว่าระบบพังเสียอีก
 *
 * เคยเกิดขึ้นจริงมาแล้วครั้งหนึ่ง เทสต์นี้จึงมีไว้ให้จับได้ตั้งแต่ตอนรันเทสต์
 */

// รากของแพ็กเกจ — node:test ถูกเรียกผ่าน npm test เสมอ ซึ่งรันจากโฟลเดอร์นี้
//
// ไม่ใช้ import.meta.url เพราะโปรเจกต์นี้เป็น CommonJS (package.json ไม่ได้ตั้ง type: module)
// ไวยากรณ์นั้นเป็นของ ESM ล้วน tsc จึงปฏิเสธ ที่ผ่านมารันได้เพราะ tsx ผ่อนปรนให้เฉย ๆ
const ROOT = process.cwd();
const seedSql = readFileSync(join(ROOT, "seed", "seed.sql"), "utf8");

/** ดึง options_json ของคำถามหนึ่งข้อออกมาจาก seed.sql */
function optionCodesOf(questionCode: string): string[] {
  const match = seedSql.match(
    new RegExp(`VALUES \\('${questionCode}'.*?'(\\[.*?\\])'::jsonb`, "s")
  );
  assert.ok(match, `ไม่พบคำถาม ${questionCode} ใน seed.sql`);
  const options = JSON.parse(match![1]) as Array<{ code?: string; value?: string }>;
  return options.map((o) => o.code ?? o.value ?? "");
}

test("รหัส 'ไม่ได้ล้ม' ที่ dashboard ใช้ ยังมีอยู่จริงในคลังคำถาม", () => {
  const codes = optionCodesOf("MOTOR_FALL_NEAR_FALL");
  assert.ok(
    codes.includes("none"),
    `dashboardService นับการล้มโดยเทียบกับรหัส "none" แต่ MOTOR_FALL_NEAR_FALL มีตัวเลือก ${JSON.stringify(codes)} — ` +
      `ถ้าปล่อยไว้ ผู้ป่วยที่ตอบว่าไม่ได้ล้มจะถูกนับเป็นล้มทุกคน`
  );
});

test("รหัส 'ไม่บาดเจ็บ' ที่ dashboard ใช้ ยังมีอยู่จริงในคลังคำถาม", () => {
  const codes = optionCodesOf("MOTOR_FALL_INJURY");
  assert.ok(
    codes.includes("no_injury"),
    `dashboardService นับการบาดเจ็บโดยเทียบกับรหัส "no_injury" แต่ MOTOR_FALL_INJURY มีตัวเลือก ${JSON.stringify(codes)}`
  );
});

test("รหัสตัวเลือกทุกข้อเป็นภาษาอังกฤษ ไม่ใช่ข้อความไทย", () => {
  // เงื่อนไข show_if ในชีต template_questions อ้างถึงรหัสภาษาอังกฤษ ถ้ารหัสกลายเป็นข้อความไทย
  // เมื่อไหร่ เงื่อนไขจะไม่มีทางเป็นจริงและคำถามปลายทางจะไม่เคยถูกถาม โดยไม่มีอะไรเตือน
  const blocks = [...seedSql.matchAll(/VALUES \('([A-Z_0-9]+)'.*?'(\[.*?\])'::jsonb/gs)];
  assert.ok(blocks.length > 0, "อ่าน options_json จาก seed.sql ไม่ได้เลย");

  const offenders: string[] = [];
  for (const [, questionCode, json] of blocks) {
    const options = JSON.parse(json) as Array<{ code?: string; value?: string }>;
    for (const o of options) {
      const code = o.code ?? o.value ?? "";
      // eslint-disable-next-line no-control-regex
      if (code && !/^[\x20-\x7E]+$/.test(code)) offenders.push(`${questionCode}: ${code}`);
    }
  }
  assert.deepEqual(offenders, [], `รหัสตัวเลือกต่อไปนี้ไม่ใช่ภาษาอังกฤษ:\n  ${offenders.join("\n  ")}`);
});

/**
 * คำถามและ template ทุกแถวต้อง active
 *
 * คอลัมน์ active/required ในไฟล์ Excel เก็บเป็นสูตร =TRUE() ซึ่ง Excel เก็บผลลัพธ์ที่คำนวณไว้
 * คู่กับตัวสูตร ถ้ามีใครเปิดไฟล์ด้วย openpyxl แล้วบันทึกทับ ผลลัพธ์ที่ cache ไว้จะหายไป
 * generator จะอ่านได้ None แล้วเขียน NULL ลง seed ซึ่ง "ทับ" ค่า DEFAULT true ของตาราง
 *
 * ผลที่ตามมาคือทั้งระบบใช้งานไม่ได้ — roundService ปฏิเสธ template ที่ไม่ active (500) และ
 * responseService ปฏิเสธคำถามที่ไม่ active (400) แปลว่าสร้างบันทึกอาการไม่ได้และตอบไม่ได้เลย
 *
 * เคยเกิดขึ้นจริงมาแล้วครั้งหนึ่ง และไม่มีอะไรเตือนจนกระทั่งรัน smoke test
 * (gen_seed.py มีด่านกันอีกชั้น แต่ด่านนั้นกันได้เฉพาะตอน generate เทสต์นี้กันที่ผลลัพธ์)
 */
test("ไม่มีคำถามหรือ template ไหนถูก seed เป็น inactive", () => {
  const blocks = [
    ...seedSql.matchAll(
      /INSERT INTO pdlife\.(question_bank|checkin_templates) \(.*?\)\r?\nVALUES \((.*?)\)\r?\nON CONFLICT/gs
    ),
  ];
  assert.ok(blocks.length > 0, "อ่าน INSERT จาก seed.sql ไม่ได้เลย");

  // active เป็นคอลัมน์สุดท้ายของทั้งสองตาราง
  const offenders = blocks
    .map(([, table, values]) => ({ table, active: values.slice(values.lastIndexOf(", ") + 2) }))
    .filter((row) => row.active !== "TRUE");

  assert.deepEqual(
    offenders,
    [],
    `แถวต่อไปนี้ไม่ได้ active — ถ้าปล่อยลงฐานข้อมูล จะสร้าง round ไม่ได้และตอบคำถามไม่ได้:\n  ` +
      offenders.map((o) => `${o.table}: ${o.active}`).join("\n  ")
  );
});
