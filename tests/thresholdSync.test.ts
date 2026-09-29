import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  LATE_MED_THRESHOLD_MINUTES,
  ROSTER_FLAG_WINDOW_DAYS,
} from "../src/services/dashboardService";
import { DEFAULT_WINDOW_DAYS } from "../src/services/redFlagService";

/**
 * เกณฑ์ที่ backend กับหน้าเว็บต้องใช้ค่าเดียวกัน
 *
 * สองโปรเจกต์นี้ import กันไม่ได้ (คนละ package.json คนละ tsconfig) เกณฑ์อย่าง "ช้าเกิน
 * 30 นาที = กินสาย" จึงถูกเขียนไว้สองที่โดยจำเป็น ทางแก้ที่ถูกต้องคือให้ backend ส่งเกณฑ์
 * มากับ response หรือแยกเป็น shared package — ทั้งสองอย่างควรทำตอนออกแบบ API รอบหน้า
 * ไม่ใช่แก้แทรกตอนนี้
 *
 * ระหว่างนี้จึงยอมให้ซ้ำ แต่ไม่ยอมให้ "ซ้ำแล้วไม่ตรงกัน" — ซึ่งเป็นสถานะที่แย่ที่สุด เพราะ
 * หน้าจอเดียวจะแสดงตัวเลขที่ขัดกันเอง: ตารางบอกว่ามื้อนี้สาย แต่ตัวนับข้างบนที่ backend
 * คำนวณมาไม่ได้นับมื้อนั้น แล้วไม่มีใครรู้ว่าฝั่งไหนถูก
 *
 * เทสนี้อ่านไฟล์ของเว็บเป็นข้อความ ไม่ได้ import — เพราะ import ข้ามโปรเจกต์คือสิ่งที่ทำ
 * ไม่ได้ตั้งแต่แรก อ่านเป็นข้อความจึงเป็นวิธีเดียวที่ตรวจได้จริงโดยไม่ต้องรื้อโครงสร้าง
 */

const WEB_CONSTANTS = path.join(__dirname, "..", "..", "pdlife-web", "lib", "pdlife", "constants.ts");

/** ดึงค่าตัวเลขของ constant ตัวหนึ่งออกจากไฟล์ฝั่งเว็บ */
function webConstant(name: string): number {
  let source: string;
  try {
    source = readFileSync(WEB_CONSTANTS, "utf8");
  } catch {
    assert.fail(
      `อ่าน ${WEB_CONSTANTS} ไม่ได้ — ถ้าย้ายหรือเปลี่ยนชื่อไฟล์ constants ของเว็บ ให้แก้ path ในเทสนี้ด้วย ` +
        `อย่าลบเทสทิ้ง ไม่งั้นเกณฑ์สองฝั่งจะเพี้ยนกันโดยไม่มีใครรู้`,
    );
  }

  // ตัดเอาตัวเลขด้วย indexOf ไม่ใช้ regex โดยตั้งใจ — ครั้งแรกเขียนเป็น regex แล้ว backslash
  // หายระหว่างเขียนไฟล์ กลายเป็น (d+) ที่ไม่ match อะไรเลย เทียบข้อความตรง ๆ ไม่มีทางพลาดแบบนั้น
  const prefix = `export const ${name} = `;
  const at = source.indexOf(prefix);
  assert.notEqual(at, -1, `ไม่พบ ${name} ในไฟล์ constants ของเว็บ — ถูกเปลี่ยนชื่อหรือลบไปแล้ว`);

  const rest = source.slice(at + prefix.length);
  const value = Number(rest.slice(0, rest.indexOf(";")).trim());
  assert.ok(Number.isFinite(value), `${name} ในไฟล์ constants ของเว็บไม่ใช่ตัวเลข`);
  return value;
}

test("เกณฑ์กินสาย: เว็บกับ backend ต้องเท่ากัน", () => {
  assert.equal(
    webConstant("LATE_MINUTES"),
    LATE_MED_THRESHOLD_MINUTES,
    "LATE_MINUTES ของเว็บไม่เท่ากับ LATE_MED_THRESHOLD_MINUTES ของ backend — " +
      "จำนวนมื้อที่สายในตารางจะไม่ตรงกับตัวนับข้างบนในหน้าเดียวกัน",
  );
});

test("ช่วงดูสัญญาณเตือน: เว็บกับ backend ต้องเท่ากัน", () => {
  const web = webConstant("FLAG_DAYS");

  assert.equal(
    web,
    DEFAULT_WINDOW_DAYS,
    "FLAG_DAYS ของเว็บไม่เท่ากับ DEFAULT_WINDOW_DAYS ของ backend — " +
      "เว็บจะขอช่วงหนึ่งแต่ backend ตอบอีกช่วงเมื่อเว็บไม่ได้ระบุ days มา",
  );

  // ตัวนับธงในหน้าทะเบียนใช้ค่านี้ ถ้าไม่ตรงกับที่หน้าเวชระเบียนรายคนใช้ จำนวนธงสองหน้าจะ
  // ไม่ตรงกัน ทั้งที่เป็นผู้ป่วยคนเดียวกัน
  assert.equal(
    web,
    ROSTER_FLAG_WINDOW_DAYS,
    "FLAG_DAYS ของเว็บไม่เท่ากับ ROSTER_FLAG_WINDOW_DAYS — จำนวนธงในหน้าทะเบียนจะไม่ตรงกับหน้ารายคน",
  );
});
