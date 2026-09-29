/**
 * ล้างข้อมูลทดสอบทั้งหมดในโปรเจกต์ทดสอบ เหลือไว้แค่บัญชี admin กับคลังคำถาม
 *
 * วิธีรัน:
 *   npx tsx scripts/clean_test_data.ts
 *
 * ⚠️ สคริปต์นี้ลบข้อมูลถาวร ไม่มี undo — อ่านสามย่อหน้าข้างล่างก่อนรัน
 *
 * กันพลาดสามชั้น
 *   1. ตรวจว่า SUPABASE_URL ชี้ไปโปรเจกต์ทดสอบเท่านั้น ถ้าไม่ใช่จะหยุดทันที
 *   2. แตะเฉพาะ schema pdlife — ไม่มีคำสั่งไหนในไฟล์นี้แตะ core หรือ checkpd ซึ่งเป็นที่
 *      เก็บข้อมูลผู้ป่วยจริง (คนละโปรเจกต์กันอยู่แล้ว แต่กันไว้อีกชั้น)
 *   3. ต้องพิมพ์ยืนยันเองก่อนลบ และแสดงจำนวนแถวที่จะลบให้ดูก่อนเสมอ
 *
 * เรื่องที่คนมักลืม: บัญชีล็อกอินอยู่ใน Supabase Auth ซึ่งเป็นคนละที่กับตาราง pdlife.users
 * ถ้าลบแต่ตารางเรา บัญชีจะค้างเป็นขยะและเบอร์โทรเดิมจะสมัครซ้ำไม่ได้ สคริปต์นี้จึงลบทั้งสองที่
 */
import "dotenv/config";
import { createInterface } from "node:readline";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** โปรเจกต์ทดสอบของ PDLIFE — โปรเจกต์เก่าที่มีข้อมูลผู้ป่วยจริงคือ mieiwzfhohifeprjtnek */
const ALLOWED_PROJECT_REF = "oibjuxjiaftkcdhxyvuh";

const DB = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Accept-Profile": "pdlife",
  "Content-Profile": "pdlife",
  "Content-Type": "application/json",
};

/**
 * ลำดับการลบ — ลูกก่อนแม่เสมอ
 *
 * หลายตารางมี ON DELETE CASCADE อยู่แล้ว แต่บางตารางอ้างถึง users ผ่านคอลัมน์ที่ไม่ cascade
 * (เช่น appointments.doctor_id, event_logs.recorded_by) การลบ users ก่อนจะติด FK
 * ลบเรียงเองจึงชัดเจนกว่าและไม่ต้องพึ่งว่าตารางไหน cascade บ้าง
 *
 * ต้องระบุชื่อคอลัมน์ primary key คู่กันด้วย เพราะ PostgREST บังคับให้มีเงื่อนไขเสมอถึงจะยอมลบ
 * และไม่ใช่ทุกตารางที่ใช้ "id" — patient_medications ใช้ prescription_id ส่วน patient_profiles
 * ใช้ user_id (ไล่ดูจาก docs/pdlife_schema_v3_3.sql ครบทั้ง 15 ตารางแล้ว ไม่ได้เดา)
 */
const TABLES_TO_WIPE: Array<[table: string, pk: string]> = [
  ["audit_logs", "id"],
  ["notifications", "id"],
  ["red_flags", "id"],
  ["responses", "id"],
  ["round_instances", "id"],
  ["medication_logs", "id"],
  // doctor_notes.assessment_id อ้าง clinic_assessments(id) — ต้องลบ doctor_notes ก่อนเสมอ
  // (เจอจริงตอนรัน: ลบ clinic_assessments ก่อนแล้วชน FK 23503 เพราะ doctor_notes ยังอ้างอยู่)
  ["doctor_notes", "id"],
  ["clinic_assessments", "id"],
  ["event_logs", "id"],
  ["patient_medications", "prescription_id"],
  ["appointments", "id"],
  ["consents", "id"],
  ["devices", "id"],
  ["patient_caregivers", "id"],
  ["patient_profiles", "user_id"],
];

/** คลังคำถามมาจาก seed.sql ไม่ใช่ข้อมูลทดสอบ — ห้ามลบ ไม่งั้นต้องรัน seed ใหม่ */
const KEEP_TABLES = ["question_bank", "checkin_templates", "template_questions"];

async function countRows(table: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: { ...DB, Prefer: "count=exact" },
  });
  const range = res.headers.get("content-range") ?? "";
  return Number(range.split("/")[1] ?? 0);
}

async function deleteAll(table: string, filter: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    headers: DB,
  });
  if (!res.ok) throw new Error(`ลบ ${table} ไม่สำเร็จ (${res.status}): ${await res.text()}`);
}

function confirm(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => (rl.close(), resolve(a.trim()))));
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("ไม่พบ SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY ใน .env");
    process.exit(1);
  }

  if (!SUPABASE_URL.includes(ALLOWED_PROJECT_REF)) {
    console.error("\n  ❌ หยุด — SUPABASE_URL ไม่ใช่โปรเจกต์ทดสอบ");
    console.error(`     ชี้ไป : ${SUPABASE_URL}`);
    console.error(`     ต้องเป็น: ${ALLOWED_PROJECT_REF}\n`);
    console.error("     สคริปต์นี้ลบข้อมูลถาวร จึงยอมทำงานกับโปรเจกต์ทดสอบเท่านั้น\n");
    process.exit(1);
  }

  // --- หา admin ที่จะเก็บไว้ ---
  const users = (await (
    await fetch(`${SUPABASE_URL}/rest/v1/users?select=id,user_name,role,auth_uid`, { headers: DB })
  ).json()) as Array<{ id: string; user_name: string; role: string; auth_uid: string | null }>;

  const admins = users.filter((u) => u.role === "admin");
  if (admins.length === 0) {
    console.error("\n  ❌ หยุด — ไม่พบบัญชี admin เลย");
    console.error("     ถ้าลบตอนนี้จะเข้าระบบไม่ได้อีก สร้าง admin ก่อนแล้วค่อยรันใหม่\n");
    process.exit(1);
  }

  const keepUserIds = new Set(admins.map((a) => a.id));
  const keepAuthUids = new Set(admins.map((a) => a.auth_uid).filter((x): x is string => !!x));

  // --- นับให้ดูก่อน ---
  console.log(`\n  โปรเจกต์: ${SUPABASE_URL}\n`);
  console.log("  จะลบ");
  let total = 0;
  for (const [t] of TABLES_TO_WIPE) {
    const n = await countRows(t);
    total += n;
    if (n > 0) console.log(`    ${t.padEnd(22)} ${String(n).padStart(6)} แถว`);
  }
  const userCount = users.length - admins.length;
  const medCount = await countRows("medications");
  total += userCount + medCount;
  console.log(`    ${"users".padEnd(22)} ${String(userCount).padStart(6)} แถว  (เก็บ admin ${admins.length} คน)`);
  console.log(`    ${"medications".padEnd(22)} ${String(medCount).padStart(6)} แถว`);

  const authUsers = await listAuthUsers();
  const authToDelete = authUsers.filter((u) => !keepAuthUids.has(u.id));
  console.log(`    ${"Supabase Auth".padEnd(22)} ${String(authToDelete.length).padStart(6)} บัญชี`);

  console.log("\n  จะเก็บไว้");
  for (const t of KEEP_TABLES) console.log(`    ${t.padEnd(22)} ${String(await countRows(t)).padStart(6)} แถว`);
  for (const a of admins) console.log(`    admin                  ${a.user_name}`);

  if (total === 0 && authToDelete.length === 0) {
    console.log("\n  ไม่มีอะไรให้ลบ — สะอาดอยู่แล้ว\n");
    return;
  }

  const answer = await confirm(`\n  พิมพ์ DELETE เพื่อยืนยันการลบ (อย่างอื่น = ยกเลิก): `);
  if (answer !== "DELETE") {
    console.log("\n  ยกเลิก ไม่ได้ลบอะไร\n");
    return;
  }

  // --- ลบ ---
  console.log("");
  for (const [t, pk] of TABLES_TO_WIPE) {
    await deleteAll(t, `${pk}=not.is.null`);
    console.log(`  ✓ ${t}`);
  }

  const keepList = [...keepUserIds].map((id) => `"${id}"`).join(",");
  await deleteAll("users", `id=not.in.(${keepList})`);
  console.log("  ✓ users (เก็บ admin ไว้)");

  await deleteAll("medications", "id=not.is.null");
  console.log("  ✓ medications");

  let removed = 0;
  for (const u of authToDelete) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (res.ok) removed++;
  }
  console.log(`  ✓ Supabase Auth (ลบ ${removed}/${authToDelete.length} บัญชี)`);

  console.log("\n  ล้างเรียบร้อย — ขั้นต่อไป: npx tsx scripts/seed_mock.ts\n");
}

async function listAuthUsers(): Promise<Array<{ id: string; email?: string; phone?: string }>> {
  const all: Array<{ id: string; email?: string; phone?: string }> = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const body = (await res.json()) as { users?: Array<{ id: string }> };
    const list = body.users ?? [];
    all.push(...list);
    if (list.length < 200) break;
  }
  return all;
}

main().catch((err) => {
  console.error("\n  สคริปต์ล้ม:", err.message ?? err, "\n");
  process.exit(1);
});
