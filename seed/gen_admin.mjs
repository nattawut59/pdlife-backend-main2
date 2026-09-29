#!/usr/bin/env node
/**
 * สร้างคำสั่ง INSERT สำหรับบัญชี admin คนแรกของระบบ
 *
 * /auth/provision ต้องมี admin อยู่ก่อนถึงจะเรียกได้ แปลว่า admin คนแรกสร้างผ่าน API ไม่ได้
 * ต้องใส่เข้าฐานข้อมูลตรงๆ — สคริปต์นี้ทำหน้าที่นั้นอย่างเดียว
 *
 * รหัสผ่านจะไม่ถูกเขียนลงไฟล์ในรูปแบบที่ย้อนกลับได้: seed/admin.generated.sql เก็บแค่ bcrypt hash
 * และไฟล์นั้นอยู่ใน .gitignore — ตั้งใจออกแบบแบบนี้ เพราะรหัสที่ hardcode ไว้แบบเดิมคือรหัสที่
 * ทุกคนที่เข้าถึง repo ได้รู้หมด ตอนที่ repo ยังเป็น public
 *
 *   node seed/gen_admin.mjs                      สุ่มรหัส 24 ตัว (ค่าเริ่มต้น)
 *   node seed/gen_admin.mjs --prompt             พิมพ์รหัสเอง ไม่แสดงบนจอ
 *   node seed/gen_admin.mjs --password "รหัส"    พิมพ์รหัสเองแบบใส่ในคำสั่งเลย
 *
 * จากนั้นเอา seed/seed.sql ไปรันก่อน แล้วตามด้วย seed/admin.generated.sql ใน Supabase SQL editor
 */
import { randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

// ตัดตัวอักษรที่อ่านสับสนตอนพิมพ์ด้วยมือออก: 0/O และ 1/l/I
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const PASSWORD_LENGTH = 24;

// ต้องตรงกับ SALT_ROUNDS ใน src/utils/password.ts ไม่งั้นแอป verify hash นี้ไม่ผ่าน
const SALT_ROUNDS = 10;

// ค่าต่ำสุดตรงกับ registerSchema ใน src/schemas/authSchema.ts
// ส่วนเพดาน 72 ไบต์ไม่ใช่เรื่องนโยบาย แต่เป็นข้อจำกัดของ bcrypt เองที่อ่านแค่ 72 ไบต์แรก
// แล้วทิ้งที่เหลือเงียบๆ — ถ้าปล่อยให้ยาวกว่านี้ รหัสจะไม่ได้หมายความอย่างที่ผู้ใช้ตั้งใจ
// ภาษาไทย 1 ตัวอักษร = 3 ไบต์ ดังนั้นเพดานจริงคือประมาณ 24 ตัวอักษรไทย
const MIN_PASSWORD_BYTES = 8;
const MAX_PASSWORD_BYTES = 72;

// ยาวพอที่การเดาสุ่มไม่คุ้ม ต่ำกว่านี้แค่เตือน ไม่บล็อก — เป็นสิทธิ์ตัดสินใจของคนใช้ ไม่ใช่ของสคริปต์
const RECOMMENDED_LENGTH = 12;

const OUT_PATH = join(dirname(fileURLToPath(import.meta.url)), "admin.generated.sql");

function generatePassword() {
  // ใช้ randomInt เพราะมันทำ rejection sampling ทำให้ทุกตัวอักษรมีโอกาสเท่ากันจริง
  // ถ้าใช้ randomBytes[i] % ALPHABET.length ตัวอักษรต้นๆ ของชุดจะออกบ่อยกว่าเพื่อนแบบเงียบๆ
  return Array.from({ length: PASSWORD_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

/** อ่านข้อความจาก terminal โดยไม่แสดงตัวอักษรบนจอ และไม่ตกไปอยู่ใน shell history */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (chunk) => {
      if (!muted) rl.output.write(chunk);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/** บล็อกเฉพาะกรณีที่ทำให้ระบบทำงานผิด ส่วนรหัสที่แค่อ่อนแอให้เตือนแล้วปล่อยผ่าน */
function checkPassword(password) {
  const bytes = Buffer.byteLength(password, "utf8");

  if (bytes < MIN_PASSWORD_BYTES) {
    fail(`รหัสผ่านสั้นเกินไป (${bytes} ไบต์) — ตัวแอปเองบังคับอย่างน้อย ${MIN_PASSWORD_BYTES} ไบต์`);
  }
  if (bytes > MAX_PASSWORD_BYTES) {
    fail(
      `รหัสผ่านยาว ${bytes} ไบต์ แต่ bcrypt อ่านแค่ ${MAX_PASSWORD_BYTES} ไบต์แรกแล้วทิ้งที่เหลือ\n` +
        `  จำกัดที่ ${MAX_PASSWORD_BYTES} ไบต์ (ประมาณ 24 ตัวอักษรไทย หรือ 72 ตัวอักษรอังกฤษ)`
    );
  }

  const warnings = [];
  if (password.length < RECOMMENDED_LENGTH) {
    warnings.push(`ยาวแค่ ${password.length} ตัว — ${RECOMMENDED_LENGTH} ตัวขึ้นไปเดายากกว่ามาก`);
  }
  if (/^[a-z]+$/.test(password) || /^\d+$/.test(password)) {
    warnings.push("มีตัวอักษรชนิดเดียว — ผสมตัวอักษร ตัวเลข และสัญลักษณ์จะแข็งแรงกว่า");
  }
  if (/^(change|password|admin|secret|test|pdlife|123)/i.test(password)) {
    warnings.push("ขึ้นต้นด้วยคำที่คนร้ายลองเป็นอันดับแรกๆ");
  }

  if (warnings.length > 0) {
    console.warn("\n  ⚠  บัญชีนี้สร้างบัญชีหมอได้ และหมอเข้าถึงข้อมูลผู้ป่วยได้");
    for (const warning of warnings) console.warn(`     - ${warning}`);
    console.warn("     ดำเนินการต่อให้ — เป็นสิทธิ์ตัดสินใจของคุณ");
  }
}

async function resolvePassword(argv) {
  const inlineIndex = argv.indexOf("--password");
  if (inlineIndex !== -1) {
    const value = argv[inlineIndex + 1];
    if (!value || value.startsWith("--")) fail('ไม่ได้ใส่ค่า: node seed/gen_admin.mjs --password "รหัสของคุณ"');
    console.warn("\n  หมายเหตุ: รหัสที่ใส่แบบนี้จะถูกบันทึกไว้ใน shell history ของเครื่อง");
    console.warn("  ถ้าไม่อยากให้เก็บ ใช้ --prompt แทน");
    return { password: value, chosen: true };
  }

  if (argv.includes("--prompt")) {
    const password = await promptHidden("  ตั้งรหัสผ่าน admin (ไม่แสดงตัวอักษร): ");
    if (!password) fail("ไม่ได้ใส่รหัสผ่าน");
    const confirm = await promptHidden("  พิมพ์อีกครั้งเพื่อยืนยัน: ");
    if (password !== confirm) fail("รหัสสองครั้งไม่ตรงกัน — ไม่ได้เขียนไฟล์อะไรทั้งนั้น");
    return { password, chosen: true };
  }

  return { password: generatePassword(), chosen: false };
}

const { password, chosen } = await resolvePassword(process.argv.slice(2));
if (chosen) checkPassword(password);

const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);

// ผลลัพธ์ของ bcrypt มีแค่ [A-Za-z0-9./$] จึงไม่มีทางหลุดออกนอกเครื่องหมายคำพูดใน SQL
// ON CONFLICT DO NOTHING ทำให้การรันซ้ำไม่ไปรีเซ็ตรหัสของ admin ที่เปลี่ยนรหัสไปแล้ว
// (รันซ้ำจะได้รหัสใหม่ แต่รหัสนั้นจะไม่ถูกนำไปใช้)
const insert = `-- สร้างโดย seed/gen_admin.mjs — ห้าม commit ไฟล์นี้
-- ไฟล์นี้เก็บแค่ bcrypt hash ไม่มีรหัสผ่านตัวจริง ถ้าลืมรหัสให้ลบแถว admin ทิ้งแล้วรันสคริปต์ใหม่

INSERT INTO pdlife.users (first_name, last_name, user_name, role, password_hash, is_active)
VALUES ('Admin', 'Bootstrap', 'admin', 'admin', '${passwordHash}', TRUE)
ON CONFLICT (user_name) DO NOTHING;
`;

writeFileSync(OUT_PATH, insert, "utf8");

console.log(`
  สร้างบัญชี admin เรียบร้อย

    user_name : admin
    password  : ${chosen ? "(รหัสที่คุณเพิ่งตั้ง)" : password}
${chosen ? "" : "\n  รหัสนี้แสดงครั้งเดียวเท่านั้น บันทึกไว้เดี๋ยวนี้\n"}
  เขียนไฟล์ SQL ไว้ที่: ${OUT_PATH}
  รัน seed/seed.sql ก่อน แล้วค่อยรันไฟล์นี้

  หมายเหตุ: ระบบยังไม่มี endpoint เปลี่ยนรหัสผ่าน รหัสนี้จะใช้ไปจนกว่าจะสร้าง endpoint นั้น
  หรือแก้ hash ในฐานข้อมูลด้วยมือ
`);
