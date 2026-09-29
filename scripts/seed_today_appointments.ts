/**
 * ใส่นัดของ "วันนี้" ให้ผู้ป่วยจำลอง เพื่อให้หน้าตารางนัด / คัดกรอง / บันทึกผลตรวจ มีข้อมูลให้ดู
 *
 * วิธีรัน:
 *   npx tsx scripts/seed_today_appointments.ts
 *
 * ทำไมต้องมีสคริปต์นี้แยก — seed_mock.ts สร้างนัดให้คนละ 2 ครั้ง คือ "ผ่านมาแล้ว" กับ
 * "อีก 14 วัน" ไม่มีของวันนี้เลย พอต่อ API จริงหน้าจอจึงว่างเปล่า ซึ่งถูกต้องแต่ดูไม่ออกว่า
 * ระบบทำงาน สคริปต์นี้เติมเฉพาะนัดของวันนี้ ไม่แตะข้อมูลอื่น
 *
 * รันซ้ำได้ — ถ้ามีนัดของวันนี้อยู่แล้วจะหยุดและบอกให้ทราบ ไม่สร้างซ้อน
 *
 * เลือกสถานะให้ครบทุกแบบที่ฐานข้อมูลมี รวม missed กับ cancelled ด้วย เพราะสองอันนี้ไม่เคย
 * มีในหน้าจอตัวอย่าง จึงไม่เคยมีใครเห็นว่าหน้าตาบนจอจริงเป็นยังไง
 */
import "dotenv/config";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ALLOWED_PROJECT_REF = "oibjuxjiaftkcdhxyvuh";

const DB = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Accept-Profile": "pdlife",
  "Content-Profile": "pdlife",
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const TZ_OFFSET_MS = 7 * 60 * 60_000; // ไทย UTC+7 ไม่มี DST

/** วันนี้ตามปฏิทินไทย ไม่ใช่ UTC — ตรงกับที่ backend ใช้ตัดสินว่า "วันนี้" คือวันไหน */
function todayThai(): string {
  return new Date(Date.now() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

async function get<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: DB });
  if (!res.ok) throw new Error(`อ่าน ${path} ล้ม (${res.status}): ${await res.text()}`);
  return (await res.json()) as T;
}

async function insert<T = unknown>(table: string, rows: unknown): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: DB,
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`insert ${table} ล้ม (${res.status}): ${await res.text()}`);
  return (await res.json()) as T[];
}

/**
 * คิวของวันนี้
 *
 * เวลาไล่ตั้งแต่ 09:00 ห่างกัน 30 นาที ตามที่คลินิกจริงจัดคิว ไม่ได้สุ่ม — คิวที่เวลาไม่เรียงกัน
 * ทำให้ดูไม่ออกว่าตารางเรียงถูกไหม
 */
const SLOTS: Array<{ time: string; type: string; status: string }> = [
  { time: "09:00", type: "urgent", status: "checked_in" },
  { time: "09:30", type: "follow_up", status: "checked_in" },
  { time: "10:00", type: "routine", status: "completed" },
  { time: "10:30", type: "routine", status: "completed" },
  { time: "11:00", type: "follow_up", status: "scheduled" },
  { time: "13:30", type: "routine", status: "scheduled" },
  { time: "14:00", type: "routine", status: "scheduled" },
  { time: "14:30", type: "walk_in", status: "scheduled" },
  { time: "15:00", type: "routine", status: "missed" },
  { time: "15:30", type: "routine", status: "cancelled" },
];

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("\n  ❌ ไม่พบ SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY ใน .env\n");
    process.exit(1);
  }

  // กันไม่ให้เผลอรันใส่โปรเจกต์ที่มีข้อมูลผู้ป่วยจริง
  if (!SUPABASE_URL.includes(ALLOWED_PROJECT_REF)) {
    console.error(`\n  ❌ หยุด — SUPABASE_URL ไม่ใช่โปรเจกต์ทดสอบ (${SUPABASE_URL})\n`);
    process.exit(1);
  }

  const date = todayThai();
  console.log(`\n  โปรเจกต์: ${SUPABASE_URL}`);
  console.log(`  วันที่: ${date}\n`);

  const existing = await get<Array<{ id: string }>>(
    `appointments?visit_date=eq.${date}&select=id`,
  );
  if (existing.length > 0) {
    console.log(`  มีนัดของวันนี้อยู่แล้ว ${existing.length} รายการ — ไม่สร้างซ้ำ`);
    console.log("  ถ้าอยากสร้างใหม่ ให้ลบของเดิมก่อน แล้วค่อยรันสคริปต์นี้อีกครั้ง\n");
    return;
  }

  // ผู้ป่วยจำลองเท่านั้น — user_name ขึ้นต้นด้วย mock_ ตามที่ seed_mock.ts ตั้งไว้
  const patients = await get<Array<{ id: string; first_name: string; last_name: string }>>(
    "users?role=eq.patient&user_name=like.mock_*&select=id,first_name,last_name&order=user_name",
  );
  if (patients.length === 0) {
    console.error("  ❌ ไม่พบผู้ป่วยจำลอง — รัน scripts/seed_mock.ts ก่อน\n");
    process.exit(1);
  }

  const [doctor] = await get<Array<{ id: string; first_name: string; last_name: string }>>(
    "users?role=eq.doctor&select=id,first_name,last_name&limit=1",
  );
  if (!doctor) {
    console.error("  ❌ ไม่พบบัญชีแพทย์ในระบบ\n");
    process.exit(1);
  }

  const rows = SLOTS.slice(0, patients.length).map((slot, i) => ({
    patient_id: patients[i].id,
    doctor_id: doctor.id,
    created_by: doctor.id,
    visit_date: date,
    visit_time: slot.time,
    visit_type: slot.type,
    status: slot.status,
  }));

  const created = await insert<{ id: string }>("appointments", rows);

  console.log(`  สร้างนัดของวันนี้ ${created.length} รายการ`);
  console.log(`  แพทย์: ${doctor.first_name} ${doctor.last_name}\n`);
  for (const [i, row] of rows.entries()) {
    const p = patients[i];
    console.log(`    ${row.visit_time}  ${p.first_name} ${p.last_name}  (${row.status})`);
  }
  console.log("\n  เปิดหน้า /staff/appointments ได้เลย\n");
}

main().catch((err) => {
  console.error(`\n  ❌ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
