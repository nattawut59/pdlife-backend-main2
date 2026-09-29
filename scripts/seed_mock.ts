/**
 * สร้างข้อมูลผู้ป่วยจำลองสำหรับสาธิตและทดสอบหน้าจอ
 *
 * วิธีรัน:
 *   npx tsx scripts/seed_mock.ts
 *
 * แบ่งผู้ป่วยเป็น 5 กลุ่มตามสิ่งที่ควรเห็นบนหน้าจอหมอ — ปกติ / เฝ้าระวัง / เสี่ยง / อันตราย /
 * ยังไม่เริ่มใช้ กลุ่มสุดท้ายมีไว้ทดสอบว่าจอแยก "ยังไม่มีข้อมูล" ออกจาก "ไม่มีอาการ" ได้จริง
 * ซึ่งเป็นสองอย่างที่ต่างกันมากทางคลินิกแต่หน้าจอมักเขียนรวมกัน
 *
 * ชื่อเป็นชื่อไทยปกติเพราะใช้นำเสนอ แต่ users.user_name ขึ้นต้นด้วย mock_ เสมอ — ฟิลด์นั้น
 * ไม่โผล่บนหน้าจอหมอ จึงใช้แยกข้อมูลจำลองออกจากข้อมูลจริงได้ภายหลังโดยไม่กระทบการสาธิต
 *
 * เขียนตรงเข้าฐานข้อมูล ไม่ผ่าน API เพราะ API ประทับ answered_at เป็นเวลาปัจจุบันเสมอ
 * ถ้าไม่ย้อนหลังได้ กราฟแนวโน้มจะเหลือจุดเดียวและตัวนับ 7 วันจะไม่มีความหมาย
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";

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

const DAYS = 30;
const TZ_OFFSET_MS = 7 * 60 * 60_000; // ไทย UTC+7 ไม่มี DST

async function insert<T = any>(table: string, rows: unknown): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: DB,
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`insert ${table} ล้ม (${res.status}): ${await res.text()}`);
  return (await res.json()) as T[];
}

/** เวลาไทยของ N วันก่อน ที่ชั่วโมง:นาที ที่กำหนด แปลงกลับเป็น UTC */
function daysAgoAt(days: number, hour: number, minute = 0): Date {
  const now = new Date(Date.now() + TZ_OFFSET_MS);
  const wall = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - days,
    hour,
    minute
  );
  return new Date(wall - TZ_OFFSET_MS);
}

function pass(): string {
  // ตัวพิมพ์ใหญ่ + เลข + สัญลักษณ์ ให้ผ่านเกณฑ์ของ Supabase Auth เสมอ
  return `Pd${randomBytes(6).toString("base64url").replace(/[-_]/g, "x")}9!`;
}

async function createAuthUser(phone: string, password: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password, phone_confirm: true }),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { id: string }).id;
}

// ---------- คลังยาพาร์กินสัน ----------
//
// ไม่ใส่ drug_thai_name เพราะไม่มีจอไหนแสดง — แพทย์และเภสัชกรไทยใช้ชื่อสากลเสมอ
//
// ⚠️ ledd_factor ของ Pramipexole กับ Trihexyphenidyl ปล่อยเป็น null ทั้งที่รู้ค่าจริง
//
// คอลัมน์เป็น DECIMAL(6,4) = ตัวเลข 6 หลัก ทศนิยม 4 ตำแหน่ง จึงเก็บได้สูงสุด 99.9999
// แต่ค่าแปลง LEDD มาตรฐานของ Pramipexole คือ 100 พอดี ซึ่งล้นคอลัมน์ (error 22003)
// ส่วน Trihexyphenidyl มีค่าเป็น 0 แต่ zod ในโปรเจกต์กำหนดว่าต้อง positive จึงส่ง 0 ไม่ได้
//
// เลือกใส่ null แทนการยัดค่าที่ใกล้เคียง เพราะ 99.9999 คือตัวเลขที่ผิดและไม่มีใครรู้ว่าผิด
// ยังไม่มีโค้ดไหนคำนวณ LEDD จริง (มีแค่ประกาศ type) จึงยังไม่กระทบอะไร
// — รายละเอียดและวิธีแก้สคีมาอยู่ในรายงานที่ส่งให้ PM

const MEDICATIONS = [
  { id: "MED-001", drug_name: "Levodopa/Carbidopa 250/25", medication_class: "Levodopa", drug_form: "tablet", strength: "250/25 mg", ledd_factor: 1 },
  { id: "MED-002", drug_name: "Levodopa/Benserazide 100/25", medication_class: "Levodopa", drug_form: "tablet", strength: "100/25 mg", ledd_factor: 1 },
  { id: "MED-003", drug_name: "Pramipexole 0.25", medication_class: "Dopamine agonist", drug_form: "tablet", strength: "0.25 mg", ledd_factor: null },
  { id: "MED-004", drug_name: "Entacapone 200", medication_class: "COMT inhibitor", drug_form: "tablet", strength: "200 mg", ledd_factor: 0.33 },
  { id: "MED-005", drug_name: "Trihexyphenidyl 2", medication_class: "Anticholinergic", drug_form: "tablet", strength: "2 mg", ledd_factor: null },
  { id: "MED-006", drug_name: "Amantadine 100", medication_class: "NMDA antagonist", drug_form: "capsule", strength: "100 mg", ledd_factor: 1 },
];

// ---------- โปรไฟล์แต่ละกลุ่ม ----------

type Scenario = "normal" | "watch" | "risk" | "danger" | "new";

interface Profile {
  /** สัดส่วนมื้อยาที่กินตรงเวลา */
  adherence: number;
  /** โอกาสที่ตอบว่าอยู่ในช่วง OFF */
  offRate: number;
  /** จำนวนวันติดกันที่บังคับให้เป็น OFF (ทดสอบเกณฑ์ OFF ติดกัน) */
  offStreak: number;
  /** คะแนนอาการทั่วไป 0-4 */
  symptom: number;
  falls: "none" | "near" | "injury";
  /** ยิงธง MOOD-04 หรือไม่ */
  suicidalFlag: boolean;
  orthostatic: number;
}

const PROFILES: Record<Scenario, Profile> = {
  normal: { adherence: 0.96, offRate: 0.08, offStreak: 0, symptom: 1, falls: "none", suicidalFlag: false, orthostatic: 0 },
  watch:  { adherence: 0.58, offRate: 0.42, offStreak: 4, symptom: 2, falls: "none", suicidalFlag: false, orthostatic: 1 },
  risk:   { adherence: 0.72, offRate: 0.35, offStreak: 2, symptom: 3, falls: "near", suicidalFlag: false, orthostatic: 2 },
  danger: { adherence: 0.45, offRate: 0.55, offStreak: 5, symptom: 4, falls: "injury", suicidalFlag: true, orthostatic: 3 },
  new:    { adherence: 0,    offRate: 0,    offStreak: 0, symptom: 0, falls: "none", suicidalFlag: false, orthostatic: 0 },
};

const PATIENTS: Array<{ first: string; last: string; scenario: Scenario; age: number; stage: number; gender: "male" | "female" }> = [
  { first: "สมชาย", last: "ใจดี",        scenario: "normal", age: 62, stage: 1, gender: "male" },
  { first: "บุญเรือน", last: "แสงทอง",   scenario: "normal", age: 68, stage: 2, gender: "female" },
  { first: "ประสิทธิ์", last: "วงศ์สกุล", scenario: "normal", age: 59, stage: 1, gender: "male" },
  { first: "วิไล", last: "พรหมมา",       scenario: "watch",  age: 71, stage: 2, gender: "female" },
  { first: "อนันต์", last: "ศรีสุข",      scenario: "watch",  age: 66, stage: 3, gender: "male" },
  { first: "จันทร์เพ็ญ", last: "มณีรัตน์", scenario: "watch",  age: 74, stage: 2, gender: "female" },
  { first: "สุนทร", last: "เกษมสุข",     scenario: "risk",   age: 77, stage: 3, gender: "male" },
  { first: "มาลี", last: "อินทรีย์",      scenario: "risk",   age: 70, stage: 3, gender: "female" },
  { first: "ถาวร", last: "บุญมาก",       scenario: "danger", age: 79, stage: 4, gender: "male" },
  { first: "สมหญิง", last: "ทองสุข",     scenario: "danger", age: 73, stage: 4, gender: "female" },
  { first: "ณรงค์", last: "รักไทย",      scenario: "new",    age: 64, stage: 1, gender: "male" },
];

const CAREGIVERS = [
  { first: "ปรีชา", last: "ใจดี", relationship: "บุตร" },
  { first: "อารีย์", last: "ทองสุข", relationship: "คู่สมรส" },
];

// ---------- ตัวช่วยสร้างคำตอบ ----------

const credentials: Array<{ role: string; name: string; login: string; password: string }> = [];

async function makeUser(
  first: string,
  last: string,
  role: string,
  phoneSuffix: number,
  withLogin: boolean
): Promise<{ id: string; phone: string }> {
  const phone = `+6681${String(1000000 + phoneSuffix).slice(-7)}`;
  const password = pass();
  const authUid = withLogin ? await createAuthUser(phone, password) : null;

  const [row] = await insert<{ id: string }>("users", {
    first_name: first,
    last_name: last,
    // ไม่โผล่บนหน้าจอหมอ — ใช้แยกข้อมูลจำลองออกจากข้อมูลจริงได้ภายหลัง
    user_name: `mock_${role}_${phoneSuffix}`,
    role,
    phone_number: phone,
    auth_uid: authUid,
  });

  if (withLogin && authUid) {
    credentials.push({ role, name: `${first} ${last}`, login: phone, password });
  }
  return { id: row.id, phone };
}

async function main() {
  if (!SUPABASE_URL.includes(ALLOWED_PROJECT_REF)) {
    console.error(`\n  ❌ หยุด — SUPABASE_URL ไม่ใช่โปรเจกต์ทดสอบ (${SUPABASE_URL})\n`);
    process.exit(1);
  }

  console.log(`\n  โปรเจกต์: ${SUPABASE_URL}\n`);

  // --- คลังยา ---
  await insert("medications", MEDICATIONS);
  console.log(`  ✓ คลังยา ${MEDICATIONS.length} รายการ`);

  // --- บุคลากร ---
  const doctor = await makeUser("นายแพทย์สมศักดิ์", "เวชกุล", "doctor", 900001, true);
  const nurse = await makeUser("พยาบาลกาญจนา", "ดวงแก้ว", "nurse", 900002, true);
  console.log("  ✓ หมอ 1 คน พยาบาล 1 คน");

  // --- ผู้ดูแล ---
  const caregivers = [];
  for (const [i, c] of CAREGIVERS.entries()) {
    caregivers.push(await makeUser(c.first, c.last, "caregiver", 910001 + i, true));
  }
  console.log(`  ✓ ผู้ดูแล ${caregivers.length} คน`);

  // --- ผู้ป่วย ---
  let seq = 0;
  const summary: Record<Scenario, number> = { normal: 0, watch: 0, risk: 0, danger: 0, new: 0 };

  for (const p of PATIENTS) {
    seq++;
    const prof = PROFILES[p.scenario];
    const user = await makeUser(p.first, p.last, "patient", 920000 + seq, true);
    const birthYear = new Date().getUTCFullYear() - p.age;

    await insert("patient_profiles", {
      user_id: user.id,
      hn_number: `HN${String(60000 + seq)}`,
      gender: p.gender,
      date_of_birth: `${birthYear}-05-15`,
      diagnosis: "PD",
      diagnosis_date: `${birthYear + p.age - 4}-03-01`,
      hoehn_yahr_stage: p.stage,
      wake_time: "06:30",
      sleep_time: "21:30",
      province: "กรุงเทพมหานคร",
    });

    await insert("consents", {
      user_id: user.id,
      consent_type: "pdpa",
      version: "1.0",
      accepted: true,
      accepted_at: daysAgoAt(DAYS + 2, 9).toISOString(),
    });

    await insert("devices", {
      user_id: user.id,
      expo_push_token: `ExponentPushToken[mock-${seq}-${randomBytes(4).toString("hex")}]`,
      platform: seq % 2 === 0 ? "ios" : "android",
      app_version: "1.0.0",
    });

    // นัดหมาย: ครั้งที่ผ่านมาแล้วหนึ่ง ครั้งถัดไปหนึ่ง — previsit round ต้องมีนัดจึงจะสร้างได้
    const [pastAppt, upcomingAppt] = await insert<{ id: string; visit_date: string }>("appointments", [
      {
        patient_id: user.id, doctor_id: doctor.id, created_by: doctor.id,
        visit_date: daysAgoAt(DAYS - 2, 9).toISOString().slice(0, 10),
        visit_time: "09:30", visit_type: "routine", status: "completed",
      },
      {
        patient_id: user.id, doctor_id: doctor.id, created_by: doctor.id,
        visit_date: daysAgoAt(-14, 9).toISOString().slice(0, 10),
        visit_time: "10:00", visit_type: "follow_up", status: "scheduled",
      },
    ]);

    if (p.scenario === "new") {
      // ตั้งใจไม่ใส่อะไรอีก — ผู้ป่วยที่สมัครแล้วยังไม่เคยบันทึกอาการ
      summary.new++;
      continue;
    }

    // --- ใบสั่งยา ---
    const times = p.stage >= 3 ? ["07:00", "11:00", "15:00", "19:00"] : ["08:00", "13:00", "18:00"];
    const [rx] = await insert<{ prescription_id: string }>("patient_medications", {
      patient_id: user.id,
      prescribed_by: doctor.id,
      prescribed_by_name: "นายแพทย์สมศักดิ์ เวชกุล",
      medication_id: p.stage >= 3 ? "MED-001" : "MED-002",
      scheduled_times: times,
      frequency: `วันละ ${times.length} ครั้ง`,
      start_date: daysAgoAt(DAYS, 0).toISOString().slice(0, 10),
      active: true,
    });

    await buildDiary(user.id, rx.prescription_id, prof);
    await addScreeningAndNote(
      user.id,
      pastAppt.id,
      upcomingAppt.visit_date,
      p.scenario,
      prof,
      doctor.id,
      nurse.id
    );
    summary[p.scenario]++;
  }

  // --- ผูกผู้ดูแลกับผู้ป่วยกลุ่มอันตราย (คนที่ต้องมีคนช่วยจริง) ---
  const dangerIdx = PATIENTS.map((p, i) => (p.scenario === "danger" ? i : -1)).filter((i) => i >= 0);
  const patientRows = (await (
    await fetch(`${SUPABASE_URL}/rest/v1/users?select=id,user_name&role=eq.patient&user_name=like.mock_*`, { headers: DB })
  ).json()) as Array<{ id: string; user_name: string }>;

  for (const [n, idx] of dangerIdx.entries()) {
    const target = patientRows.find((r) => r.user_name === `mock_patient_${920000 + idx + 1}`);
    if (target && caregivers[n]) {
      await insert("patient_caregivers", {
        patient_id: target.id,
        caregiver_id: caregivers[n].id,
        relationship: CAREGIVERS[n].relationship,
        can_answer: true,
        is_primary: true,
        active: true,
      });
    }
  }
  console.log("  ✓ ผูกผู้ดูแลกับผู้ป่วยกลุ่มอันตราย");

  console.log("\n  สรุปผู้ป่วยที่สร้าง");
  console.log(`    🟢 ปกติ          ${summary.normal} คน`);
  console.log(`    🟡 เฝ้าระวัง      ${summary.watch} คน`);
  console.log(`    🟠 เสี่ยง         ${summary.risk} คน`);
  console.log(`    🔴 อันตราย       ${summary.danger} คน`);
  console.log(`    ⚪ ยังไม่เริ่มใช้  ${summary.new} คน`);

  console.log("\n  ─────────────────────────────────────────────────────────────");
  console.log("  บัญชีสำหรับล็อกอิน — เก็บไว้ที่ปลอดภัย ไม่ต้องส่งต่อในแชต");
  console.log("  ─────────────────────────────────────────────────────────────");
  for (const c of credentials) {
    console.log(`  ${c.role.padEnd(10)} ${c.name.padEnd(26)} ${c.login}  ${c.password}`);
  }
  console.log("");
}

/** สร้างบันทึกกินยา รอบเช็คอิน คำตอบ เหตุการณ์ และธง ย้อนหลัง DAYS วัน */
async function buildDiary(patientId: string, prescriptionId: string, prof: Profile) {
  const medLogs: any[] = [];
  const rounds: any[] = [];

  for (let d = DAYS; d >= 1; d--) {
    const inOffStreak = d <= prof.offStreak;

    // --- มื้อยา ---
    for (const hour of [8, 13, 18]) {
      const planned = daysAgoAt(d, hour);
      const onTime = Math.random() < prof.adherence;
      const taken = Math.random() < prof.adherence + 0.2;
      medLogs.push({
        patient_id: patientId,
        prescription_id: prescriptionId,
        planned_at: planned.toISOString(),
        // late_minutes เป็น GENERATED column — ห้ามส่งค่าเอง ฐานข้อมูลคำนวณจากผลต่างนี้
        taken_at: taken
          ? new Date(planned.getTime() + (onTime ? 5 : 45) * 60_000).toISOString()
          : null,
        status: taken ? "taken" : "skipped",
      });
    }

    // --- รอบเช็คอินหลังกินยา (ป้อนกราฟ ON/OFF) ---
    rounds.push({
      patient_id: patientId,
      template_code: "POST_MED_MICRO",
      prescription_id: prescriptionId,
      scheduled_at: daysAgoAt(d, 9).toISOString(),
      status: "completed",
      completed_at: daysAgoAt(d, 9, 20).toISOString(),
      _kind: "post_med",
      _day: d,
      _off: inOffStreak || Math.random() < prof.offRate,
    });

    // --- รอบสรุปตอนเย็น ---
    // ต้องมี prescription_id: null ด้วย ถึงจะมี key ครบเท่ารอบหลังกินยา — PostgREST ปฏิเสธ
    // bulk insert ที่ object แต่ละตัวมี key ไม่ตรงกัน ("All object keys must match")
    rounds.push({
      patient_id: patientId,
      template_code: "EVENING_DAILY_CORE",
      prescription_id: null,
      scheduled_at: daysAgoAt(d, 20).toISOString(),
      status: "completed",
      completed_at: daysAgoAt(d, 20, 15).toISOString(),
      _kind: "evening",
      _day: d,
      _off: false,
    });
  }

  await insert("medication_logs", medLogs);

  const meta = rounds.map((r) => ({ kind: r._kind, day: r._day, off: r._off }));
  const created = await insert<{ id: string }>(
    "round_instances",
    rounds.map(({ _kind, _day, _off, ...rest }) => rest)
  );

  const responses: any[] = [];
  const events: any[] = [];

  for (const [i, round] of created.entries()) {
    const { kind, day, off } = meta[i];

    if (kind === "post_med") {
      // ⚠️ ทั้งสามข้อต้องใช้ answered_at เดียวกันเป๊ะ — v_onoff_timeline จัดกลุ่มด้วยคอลัมน์นี้
      // ถ้าเวลาต่างกันแม้มิลลิวินาทีเดียว กราฟจะแตกเป็นสามแถวที่มีค่าว่างสองในสาม
      const at = daysAgoAt(day, 9, 20).toISOString();
      responses.push(
        { patient_id: patientId, round_instance_id: round.id, question_code: "MED_ADHERENCE", answer_value: { choice: Math.random() < prof.adherence ? "taken_ontime" : "taken_late" }, answered_by_role: "patient", answered_at: at },
        { patient_id: patientId, round_instance_id: round.id, question_code: "MED_ONOFF_NOW", answer_value: { choice: off ? "state_off" : "state_on" }, answered_by_role: "patient", answered_at: at },
        { patient_id: patientId, round_instance_id: round.id, question_code: "MED_DYSKINESIA_NOW", answer_value: { choice: prof.symptom >= 3 ? "yes_disturb" : "no" }, answered_by_role: "patient", answered_at: at }
      );
      continue;
    }

    const at = daysAgoAt(day, 20, 15).toISOString();
    const s = prof.symptom;
    const add = (code: string, value: any) =>
      responses.push({ patient_id: patientId, round_instance_id: round.id, question_code: code, answer_value: value, answered_by_role: "patient", answered_at: at });

    add("MOTOR_WALK_BALANCE", { choice: String(s), score: s });
    add("MOTOR_TREMOR_IMPACT", { choice: String(Math.max(0, s - 1)), score: Math.max(0, s - 1) });
    add("SLEEP_DAYTIME_SLEEPINESS", { choice: String(s), score: s });
    add("OTHER_FATIGUE", { choice: String(s), score: s });
    add("OTHER_PAIN_CRAMP", { choice: String(Math.max(0, s - 1)), score: Math.max(0, s - 1) });
    add("MOOD_ANXIETY", { choice: String(Math.max(0, s - 1)), score: Math.max(0, s - 1) });
    add("MED_DYSKINESIA_TODAY", { choice: s >= 3 ? "yes" : "no" });

    // หน้ามืดเมื่อลุกยืน — ใช้ score เพราะ dashboard นับจากคะแนน
    const ohCodes = ["no", "mild_once", "mild_repeat", "near_faint", "faint"];
    add("AUTO_ORTHOSTATIC_SYMPTOM", { choice: ohCodes[prof.orthostatic], score: prof.orthostatic });

    // การล้ม — ใส่เฉพาะบางวัน ไม่งั้นตัวเลขบนหน้าจอจะสูงจนไม่สมจริง
    const fellToday = prof.falls !== "none" && day % 6 === 0;
    add("MOTOR_FALL_NEAR_FALL", {
      choice: fellToday ? (prof.falls === "injury" ? "fall_real" : "near_fall") : "none",
    });
    if (fellToday && prof.falls === "injury") {
      add("MOTOR_FALL_INJURY", { choice: day === 6 ? "medical_attention" : "minor_injury" });
      add("MOTOR_FALL_MECHANISM", { choice: "off" });
      events.push({
        patient_id: patientId,
        recorded_by: patientId,
        event_type: "emergency_other",
        severity: day === 6 ? "critical" : "severe",
        injury_occurred: true,
        required_er: day === 6,
        on_off_time: "off",
        occurred_at: daysAgoAt(day, 16).toISOString(),
        note: "ล้มระหว่างเดินไปห้องน้ำ ช่วงยาหมดฤทธิ์",
      });
    }

    // ซึมเศร้า + ประตูความปลอดภัย
    const mood = prof.suicidalFlag ? 3 : Math.max(0, s - 1);
    add("MOOD_DEPRESSED_ANHEDONIA", { choice: String(mood), score: mood });
    if (prof.suicidalFlag && day <= 3) {
      add("MOOD_SUICIDAL_IDEATION", { choice: day === 1 ? "often" : "sometimes", score: day === 1 ? 2 : 1 });
    }
  }

  const insertedResponses = await insert<{ id: string; question_code: string; answered_at: string }>(
    "responses",
    responses
  );
  if (events.length > 0) await insert("event_logs", events);

  // --- ธงสัญญาณเตือน ---
  // ผูกกับคำตอบจริงที่ทำให้เกิด เหมือนที่ backend ทำตอนผู้ป่วยตอบ ไม่งั้นหน้าจอจะแสดง
  // คำถาม/คำตอบไม่ได้ และปุ่มรับทราบจะไม่มีบริบทให้หมอตัดสินใจ
  const flags: any[] = [];
  for (const r of insertedResponses) {
    if (r.question_code === "MOOD_SUICIDAL_IDEATION") {
      flags.push({ patient_id: patientId, response_id: r.id, question_code: r.question_code, clinic_tag: "suicidal_ideation", severity: "urgent", reviewed: false });
    }
    if (r.question_code === "MOTOR_FALL_INJURY") {
      flags.push({ patient_id: patientId, response_id: r.id, question_code: r.question_code, clinic_tag: "fall_injury", severity: "urgent", reviewed: false });
    }
  }
  if (flags.length > 0) await insert("red_flags", flags);

  // --- การแจ้งเตือนที่ส่งไปแล้ว ---
  await insert(
    "notifications",
    created.slice(0, 6).map((r) => ({
      user_id: patientId,
      patient_id: patientId,
      round_instance_id: r.id,
      type: "round_reminder",
      trigger_type: "system",
      delivery_status: "sent",
      sent_at: new Date().toISOString(),
      is_read: true,
    }))
  );

}

// ---------- ฟอร์มคัดกรองของพยาบาล + บันทึกผลตรวจของแพทย์ ----------

/** ข้อความบันทึกของแพทย์ ตามความรุนแรงของแต่ละกลุ่ม (ไม่ทำกับกลุ่ม "new" — ยังไม่เคยมาตรวจ) */
const DOCTOR_NOTE_TEXT: Record<Exclude<Scenario, "new">, string> = {
  normal: "อาการโดยรวมคงที่ ไม่มีข้อบ่งชี้ให้ปรับยาในตอนนี้ นัดติดตามตามรอบปกติ",
  watch: "เริ่มมี wearing-off และนอนไม่ค่อยหลับ แนะนำติดตามใกล้ชิดขึ้น ยังไม่ปรับยาในรอบนี้",
  risk: "อาการ OFF บ่อยขึ้นและเริ่มมีอาการหกล้ม ปรับช่วงเวลาให้ยาให้ถี่ขึ้นเพื่อลดช่วง wearing-off",
  danger: "อาการทรุดชัดเจน มีความเสี่ยงด้านความปลอดภัย ปรับสูตรยาและนัดติดตามถี่ขึ้นเป็นพิเศษ",
};

const FOLLOW_UP_URGENCY: Record<Exclude<Scenario, "new">, "routine" | "soon" | "urgent"> = {
  normal: "routine",
  watch: "routine",
  risk: "soon",
  danger: "urgent",
};

/**
 * ผลคัดกรองของพยาบาล — คำนวณจากระดับความรุนแรงของกลุ่ม (prof.symptom ฯลฯ) ไม่ได้อ่านคำตอบ
 * ในแอปมาติ๊กตรงๆ เหมือนสถานการณ์จริงที่พยาบาลประเมินเอง จึงมีบางข้อไม่ตรงกับแอปให้เห็นใน
 * ตาราง cross-check ตามธรรมชาติ ต่างจาก scripts/seed_crosscheck_test.sql ที่จงใจกำหนดจุด
 * ไม่ตรงกันไว้ชัดเจนสำหรับทดสอบเคสนั้นโดยเฉพาะ
 */
function clinicAssessmentFor(prof: Profile): Record<string, boolean> {
  const s = prof.symptom;
  return {
    motor_tremor: s >= 2,
    motor_rigidity: s >= 3,
    motor_bradykinesia: s >= 3,
    motor_gait_dysfunction: s >= 2,
    speech_swallowing: s >= 3,
    gi_drooling: s >= 3,
    gi_dysphagia: s >= 4,
    gi_constipation: s >= 2,
    ans_oh: prof.orthostatic >= 1,
    ans_urinary: s >= 3,
    ans_sexual: false,
    sleep_insomnia: s >= 2,
    sleep_rbd: false,
    sleep_nocturia: s >= 3,
    sleep_eds: s >= 2,
    neuro_anxiety: s >= 2,
    neuro_depression: prof.suicidalFlag || s >= 3,
    neuro_hallucination: prof.suicidalFlag,
    neuro_dementia: s >= 4,
    neuro_icds: false,
    mf_wearing_off: s >= 2,
    mf_delay_on: s >= 3,
    mf_suboptimal_on: s >= 3,
    mf_early_morning_off: s >= 2,
    mf_dyskinesia: s >= 3,
    mf_nocturnal_hypokinesia: s >= 4,
  };
}

/** ฟอร์มคัดกรอง + บันทึกผลตรวจของนัดที่ผ่านมาแล้ว (pastAppt) — ให้ทุกกลุ่มยกเว้น "new" */
async function addScreeningAndNote(
  patientId: string,
  appointmentId: string,
  nextVisitDate: string,
  scenario: Exclude<Scenario, "new">,
  prof: Profile,
  doctorId: string,
  nurseId: string
): Promise<void> {
  const [assessment] = await insert<{ id: string }>("clinic_assessments", {
    appointment_id: appointmentId,
    patient_id: patientId,
    nurse_id: nurseId,
    ...clinicAssessmentFor(prof),
    has_caregiver: scenario === "danger",
    other_note: null,
    screened_by: "พยาบาลกาญจนา ดวงแก้ว",
    status: "submitted",
    submitted_at: daysAgoAt(DAYS - 2, 9, 45).toISOString(),
  });

  // ปรับยาเฉพาะกลุ่มที่อาการแย่พอจะต้องปรับจริง — normal/watch ยังไม่ถึงเกณฑ์
  const adjust = scenario === "risk" || scenario === "danger";
  await insert("doctor_notes", {
    appointment_id: appointmentId,
    assessment_id: assessment.id,
    doctor_id: doctorId,
    clinical_note: DOCTOR_NOTE_TEXT[scenario],
    medication_adjustment: adjust,
    reason_for_change: adjust ? "อาการ OFF ถี่ขึ้นกว่าครั้งก่อน ปรับช่วงเวลาให้ยาเพื่อคุมอาการ" : null,
    follow_up_urgency: FOLLOW_UP_URGENCY[scenario],
    next_appointment_date: nextVisitDate,
    created_at: daysAgoAt(DAYS - 2, 10, 0).toISOString(),
  });
}

main().catch((err) => {
  console.error("\n  สคริปต์ล้ม:", err.message ?? err, "\n");
  process.exit(1);
});
