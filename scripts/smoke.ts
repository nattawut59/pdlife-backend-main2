/**
 * Smoke test — ยิง API จริงทั้งระบบเพื่อดูว่ามันต่อกันติดจริงไหม
 *
 * ต่างจาก `npm test` ตรงที่ชุดนั้นรันโดยไม่แตะฐานข้อมูลเลย (SUPABASE_URL ชี้ไปที่ไม่มีอยู่จริง)
 * จึงบอกไม่ได้ว่า SQL ใน repositories เขียนถูกไหม types ตรงกับ schema จริงไหม หรือ RBAC
 * กันข้อมูลข้ามผู้ป่วยได้จริงไหม — ไฟล์นี้ตอบคำถามพวกนั้น
 *
 *   เฟส 1  เส้นทางที่ควรสำเร็จ ไล่ตามลำดับที่ข้อมูลไหลจริง
 *   เฟส 2  เส้นทางที่ "ต้องถูกปฏิเสธ" — สำคัญกว่าเฟส 1 เพราะ RLS ยังไม่เปิด
 *          โค้ดชั้นนี้จึงเป็นด่านเดียวที่กันข้อมูลผู้ป่วยรั่ว
 *   เฟส 5  สัญญาณเตือนความปลอดภัย เดินครบวงจรตั้งแต่ผู้ป่วยตอบจนหมอเห็นบนจอ
 *
 * วิธีรัน (ต้องสตาร์ท `npm run dev` ไว้ก่อน):
 *   npx tsx scripts/smoke.ts
 *
 * ⚠️ สคริปต์นี้สร้างข้อมูลจริงลงฐานข้อมูล และลบไม่ได้ (กฎโปรเจกต์คือห้ามลบ ใช้ flag แทน)
 *    รันบน project ทดสอบที่ว่างเปล่าเท่านั้น ห้ามรันบน project ที่มีข้อมูลผู้ป่วยจริง
 */
import "dotenv/config";
import { createInterface } from "node:readline";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const WEB_BASE_URL = process.env.SMOKE_WEB_URL ?? "http://localhost:3001";

/** session ที่ Supabase คืนมาตอนล็อกอิน — เฟส 4 เอาไปประกอบเป็น cookie ของเบราว์เซอร์ */
interface SupabaseSession {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id?: string };
}

// ต่อท้ายชื่อผู้ใช้ทุกครั้งที่รัน เพราะ user_name เป็น UNIQUE — รันซ้ำจะได้ไม่ชนกัน
const RUN_ID = Date.now().toString(36).slice(-6);

type Expected = number | number[];

interface Step {
  phase: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  label: string;
  method: string;
  path: string;
  expected: Expected;
  actual: number | null;
  ok: boolean;
  /** ใช้แทนตัวเลขในรายงาน เมื่อเคสนั้นตัดสินจากเนื้อหา HTML ไม่ใช่ status code */
  expectedLabel?: string;
  note?: string;
}

const steps: Step[] = [];

function matches(expected: Expected, actual: number | null): boolean {
  if (actual === null) return false;
  return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
}

interface CallOptions {
  token?: string;
  body?: unknown;
  expected: Expected;
  phase?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  note?: string;
}

/** ยิง 1 request แล้วบันทึกผลลง steps โดยไม่ throw — ต้องยิงจนจบเพื่อเห็นภาพทั้งระบบ */
async function call(label: string, method: string, path: string, opts: CallOptions) {
  const { token, body, expected, phase = 1 } = opts;
  let status: number | null = null;
  let json: any = null;
  let note = opts.note;

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    status = res.status;
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      note = note ?? `ตอบกลับไม่ใช่ JSON: ${text.slice(0, 80)}`;
    }
  } catch (err: any) {
    note = `เชื่อมต่อไม่ได้: ${err.message}`;
  }

  const ok = matches(expected, status);
  // เวลาไม่ผ่าน ให้เก็บ error จริงจาก server ไว้ จะได้ไม่ต้องเดาว่าพังเพราะอะไร
  if (!ok && json?.error) note = String(json.error) + (json.details ? ` ${JSON.stringify(json.details)}` : "");

  steps.push({ phase, label, method, path, expected, actual: status, ok, note });
  return { status, json, ok };
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    (rl as any)._writeToOutput = (chunk: string) => {
      if (!muted) (rl as any).output.write(chunk);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

/** ผู้ใช้ทดสอบ — ตั้งชื่อให้เห็นชัดว่าเป็นข้อมูลทดสอบ เพราะลบออกจากฐานข้อมูลไม่ได้ */
let phoneSeq = 0;

/** เบอร์ทดสอบที่ไม่ซ้ำกัน — หลังย้ายไป Supabase Auth เบอร์คือตัวระบุตัวตน จะซ้ำไม่ได้ */
function testPhone(): string {
  phoneSeq += 1;
  return `+668${String(Date.now()).slice(-7)}${phoneSeq % 10}`;
}

function actor(tag: string, role: "patient" | "caregiver" | "nurse" | "doctor" | "admin") {
  return {
    first_name: "SMOKE",
    last_name: tag.toUpperCase(),
    user_name: `smoke_${tag}_${RUN_ID}`,
    password: `SmokeTest-${RUN_ID}-xyz`,
    role,
    phone_number: testPhone(),
  };
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * ขอ session จาก Supabase ตรงๆ เหมือนที่แอปมือถือ (เบอร์) และเว็บ staff (อีเมล) ทำ
 * หลังย้ายไป Supabase Auth แล้ว นี่คือทางเดียวที่ผู้ป่วยล็อกอินได้ — /api/auth/login ใช้ไม่ได้แล้ว
 */
async function supabaseSignIn(
  identifier: { phone?: string; email?: string },
  password: string
): Promise<SupabaseSession | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
    body: JSON.stringify({ ...identifier, password }),
  });
  if (!res.ok) return null;
  const session = (await res.json()) as SupabaseSession;
  return session.access_token ? session : null;
}

/** ล็อกอินผ่าน Supabase แล้วบันทึกผลลง steps เหมือน call() เพื่อให้ขึ้นในรายงานเดียวกัน */
async function loginViaSupabase(
  label: string,
  identifier: { phone?: string; email?: string },
  password: string,
  phase: 1 | 2 | 3 | 4 = 1
): Promise<SupabaseSession | null> {
  const session = await supabaseSignIn(identifier, password);
  steps.push({
    phase,
    label,
    method: "POST",
    path: "/auth/v1/token",
    expected: 200,
    actual: session ? 200 : null,
    ok: Boolean(session),
    note: session ? undefined : "ขอ token จาก Supabase ไม่สำเร็จ",
  });
  return session;
}

async function login(user_name: string, password: string, label: string) {
  const { json } = await call(label, "POST", "/api/auth/login", {
    body: { user_name, password },
    expected: 200,
  });
  return json?.token as string | undefined;
}

async function main() {
  console.log(`\n  Smoke test → ${BASE_URL}   (run id: ${RUN_ID})\n`);

  const adminPassword =
    process.env.ADMIN_PASSWORD ?? (await promptHidden("  รหัสผ่าน admin (ไม่แสดงตัวอักษร): "));
  if (!adminPassword) {
    console.error("  ไม่ได้ใส่รหัสผ่าน — ยกเลิก\n");
    process.exit(1);
  }

  // ─────────────────────────────────────────────────────────────
  // เฟส 1 — เส้นทางที่ควรสำเร็จ
  // ─────────────────────────────────────────────────────────────
  await call("เซิร์ฟเวอร์ตื่น", "GET", "/health", { expected: 200 });

  const adminToken = await login("admin", adminPassword, "login admin");
  if (!adminToken) {
    console.error("\n  ❌ login admin ไม่ผ่าน — หยุดตรงนี้ เพราะขั้นต่อไปต้องใช้ token นี้ทั้งหมด");
    report();
    process.exit(1);
  }

  const doctor = actor("doc", "doctor");
  const nurse = actor("nur", "nurse");
  const patientA = actor("pa", "patient");
  const patientB = actor("pb", "patient");
  const caregiverC = actor("cg", "caregiver");

  const provisionDoctor = await call("admin สร้างบัญชีหมอ", "POST", "/api/auth/provision", { token: adminToken, body: doctor, expected: 201 });
  await call("admin สร้างบัญชีพยาบาล", "POST", "/api/auth/provision", { token: adminToken, body: nurse, expected: 201 });
  const doctorId = provisionDoctor.json?.user?.id as string | undefined;

  const regA = await call("ผู้ป่วย A สมัครเอง", "POST", "/api/auth/register", { body: patientA, expected: 201 });
  const regB = await call("ผู้ป่วย B สมัครเอง", "POST", "/api/auth/register", { body: patientB, expected: 201 });
  const regC = await call("ผู้ดูแล C สมัครเอง", "POST", "/api/auth/register", { body: caregiverC, expected: 201 });

  const idA = regA.json?.user?.id as string | undefined;
  const idB = regB.json?.user?.id as string | undefined;
  const idC = regC.json?.user?.id as string | undefined;

  const tokenDoctor = await login(doctor.user_name, doctor.password, "login หมอ");
  // ผู้ป่วยและผู้ดูแลอยู่บน Supabase Auth แล้ว — /api/auth/login ใช้กับพวกเขาไม่ได้อีก
  const tokenA = (await loginViaSupabase("login ผู้ป่วย A (Supabase)", { phone: patientA.phone_number }, patientA.password))?.access_token;
  const tokenB = (await loginViaSupabase("login ผู้ป่วย B (Supabase)", { phone: patientB.phone_number }, patientB.password))?.access_token;
  const tokenC = (await loginViaSupabase("login ผู้ดูแล C (Supabase)", { phone: caregiverC.phone_number }, caregiverC.password))?.access_token;

  await call("GET /auth/me (ผู้ป่วย A)", "GET", "/api/auth/me", { token: tokenA, expected: 200 });

  const profile = {
    date_of_birth: "1955-03-15",
    wake_time: "06:30",
    sleep_time: "21:30",
    gender: "male",
    diagnosis: "PD",
    diagnosis_date: "2019-08-01",
    hoehn_yahr_stage: 2,
    province: "กรุงเทพมหานคร",
  };
  await call("ผู้ป่วย A สร้างโปรไฟล์", "POST", "/api/patients/me", { token: tokenA, body: profile, expected: 201 });
  await call("ผู้ป่วย B สร้างโปรไฟล์", "POST", "/api/patients/me", { token: tokenB, body: profile, expected: 201 });
  await call("ผู้ป่วย A ดูโปรไฟล์ตัวเอง", "GET", "/api/patients/me", { token: tokenA, expected: 200 });

  // MED-999 กันชนกับยาจริงที่จะถูกเพิ่มภายหลัง — ถ้ามีอยู่แล้วจากการรันรอบก่อน 409 ถือว่าใช้ได้
  const medId = "MED-999";
  await call("admin เพิ่มยาเข้าคลัง", "POST", "/api/medications", {
    token: adminToken,
    body: {
      id: medId,
      drug_name: "Levodopa/Carbidopa (SMOKE TEST)",
      drug_thai_name: "ลีโวโดปา (ข้อมูลทดสอบ)",
      drug_form: "tablet",
      strength: "250/25 mg",
      ledd_factor: 1,
    },
    expected: [201, 409],
    note: "409 = มีอยู่แล้วจากการรันรอบก่อน ถือว่าผ่าน",
  });
  await call("อ่านคลังยา", "GET", "/api/medications", { token: tokenA, expected: 200 });

  await call("หมอสั่งยาให้ผู้ป่วย A", "POST", `/api/patients/${idA}/prescriptions`, {
    token: tokenDoctor,
    body: {
      medication_id: medId,
      scheduled_times: ["07:00", "12:00", "18:00"],
      doses: { "07:00": "1 เม็ด", "12:00": "1 เม็ด", "18:00": "1 เม็ด" },
      frequency: "วันละ 3 ครั้ง",
      start_date: new Date().toISOString().slice(0, 10),
    },
    expected: 201,
  });
  await call("ผู้ป่วย A ดูใบสั่งยาตัวเอง", "GET", `/api/patients/${idA}/prescriptions`, { token: tokenA, expected: 200 });

  await call("ผู้ป่วย A ผูกผู้ดูแล C", "POST", `/api/patients/${idA}/caregivers`, {
    token: tokenA,
    body: { caregiver_id: idC, relationship: "บุตร", can_answer: true, is_primary: true },
    expected: 201,
  });
  await call("ดูรายชื่อผู้ดูแลของ A", "GET", `/api/patients/${idA}/caregivers`, { token: tokenA, expected: 200 });
  await call("ผู้ดูแล C ดูผู้ป่วยในความดูแล", "GET", "/api/caregivers/me/patients", { token: tokenC, expected: 200 });

  const round = await call("ผู้ป่วย A สร้าง round", "POST", "/api/rounds/adhoc", {
    token: tokenA,
    body: { patient_id: idA },
    expected: 201,
  });
  const roundId = round.json?.round?.id as string | undefined;

  let firstCode: string | undefined;
  let firstOption: string | undefined;
  if (roundId) {
    const q = await call("ดูคำถามใน round (flow engine)", "GET", `/api/rounds/${roundId}/questions`, {
      token: tokenA,
      expected: 200,
      note: "พิสูจน์ว่า flow engine อ่านคลังคำถามที่ seed ไว้ได้",
    });
    const questions = q.json?.questions ?? [];
    steps[steps.length - 1].note = `ได้ ${questions.length} คำถาม`;
    if (questions.length === 0) {
      steps[steps.length - 1].ok = false;
      steps[steps.length - 1].note = "ได้ 0 คำถาม — flow engine อ่าน seed ไม่เจอ";
    }
    firstCode = questions[0]?.question_code;
    const opts = questions[0]?.question?.options_json ?? [];
    firstOption = opts[0]?.code ?? opts[0]?.value;
  }

  if (roundId && firstCode) {
    await call(`ตอบคำถาม ${firstCode}`, "PUT", `/api/rounds/${roundId}/responses/${firstCode}`, {
      token: tokenA,
      body: {
        ...(firstOption ? { answer_value: { choice: firstOption } } : { skipped: true }),
        submitted_at: new Date().toISOString(),
      },
      expected: 200,
    });
    const after = await call("ดูคำถามซ้ำ (ต้องขึ้นว่าตอบแล้ว)", "GET", `/api/rounds/${roundId}/questions`, {
      token: tokenA,
      expected: 200,
    });
    const answered = (after.json?.questions ?? []).find((x: any) => x.question_code === firstCode)?.answered;
    if (answered !== true) {
      steps[steps.length - 1].ok = false;
      steps[steps.length - 1].note = `answered ควรเป็น true แต่ได้ ${JSON.stringify(answered)}`;
    }
  }

  await call("ดู round ทั้งหมดของผู้ป่วย A", "GET", `/api/patients/${idA}/rounds`, { token: tokenA, expected: 200 });
  await call("ดูประวัติกินยาของผู้ป่วย A", "GET", `/api/patients/${idA}/medication-logs`, { token: tokenA, expected: 200 });

  await call("หมอเปิด dashboard summary", "GET", `/api/patients/${idA}/dashboard/summary`, { token: tokenDoctor, expected: 200 });
  await call("หมอเปิด dashboard warnings", "GET", `/api/patients/${idA}/dashboard/warnings`, { token: tokenDoctor, expected: 200 });
  await call("หมอเปิด dashboard timeline", "GET", `/api/patients/${idA}/dashboard/timeline`, { token: tokenDoctor, expected: 200 });
  await call("หมอดูรายชื่อผู้ป่วยทั้งหมด", "GET", "/api/patients?limit=10", { token: tokenDoctor, expected: 200 });

  const appUsersRes = await call("หมอเปิดรายชื่อผู้ใช้แอป", "GET", "/api/users/app-users", {
    token: tokenDoctor,
    expected: 200,
  });
  {
    const list = (appUsersRes.json?.users ?? []) as any[];
    // ผู้ดูแลต้องได้ null ไม่ใช่ 0 — responses ไม่ได้เก็บว่าผู้ดูแลคนไหนเป็นคนตอบ
    const cg = list.filter((u) => u.role === "caregiver");
    const ok = list.length > 0 && cg.every((u) => u.responses_7d === null);
    steps[steps.length - 1].ok = ok;
    steps[steps.length - 1].note = ok
      ? `ได้ ${list.length} คน · ผู้ดูแล ${cg.length} คนคืน null ถูกต้อง`
      : `ผู้ดูแลควรได้ null แต่ได้ ${JSON.stringify(cg.map((u) => u.responses_7d))}`;
  }

  // ทะเบียนรวม — แทนที่การยิง endpoint รายคนทีละคนบนหน้าเว็บ
  const rosterRes = await call("หมอเปิดทะเบียนผู้ป่วยรวม", "GET", "/api/dashboard/roster?days=7&limit=10", {
    token: tokenDoctor,
    expected: 200,
  });
  {
    const rows = (rosterRes.json?.roster ?? []) as any[];
    const row = rows.find((r) => r.patient?.id === idA);
    if (!row) {
      steps[steps.length - 1].ok = false;
      steps[steps.length - 1].note = `ไม่พบผู้ป่วย A ในทะเบียน (ได้ ${rows.length} ราย)`;
    } else {
      // ต้องมีครบทั้งสรุป ตัวนับ และจำนวนธง ไม่งั้นหน้าเว็บต้องกลับไปยิงรายคนอยู่ดี
      const complete =
        row.summary?.window &&
        typeof row.warnings?.fall_or_near_fall_count === "number" &&
        typeof row.unreviewed_flag_count === "number";
      steps[steps.length - 1].ok = complete;
      steps[steps.length - 1].note = complete
        ? `ได้ ${rows.length} ราย พร้อมสรุป+ตัวนับ+จำนวนธง ในคำขอเดียว`
        : `ข้อมูลไม่ครบ: ${JSON.stringify(row).slice(0, 160)}`;
    }
  }

  await call("ลงทะเบียนอุปกรณ์รับ push", "POST", "/api/devices", {
    token: tokenA,
    body: { expo_push_token: `ExponentPushToken[smoke-${RUN_ID}]`, platform: "android", app_version: "0.0.1-smoke" },
    expected: 201,
  });

  // ─────────────────────────────────────────────────────────────
  // เฟส 2 — เส้นทางที่ต้องถูกปฏิเสธ
  //
  // เฟส 1 พังแล้วรู้ทันทีเพราะฟีเจอร์ใช้ไม่ได้ แต่เฟส 2 พังแล้วทุกอย่างดูปกติดี —
  // ผู้ป่วยเห็นข้อมูลของคนอื่นโดยไม่มีใครสังเกต จึงเป็นส่วนที่สำคัญกว่า
  // ─────────────────────────────────────────────────────────────
  const p2 = { phase: 2 as const };

  await call("ผู้ดูแล C ดูข้อมูลผู้ป่วย A ที่ผูกไว้", "GET", `/api/patients/${idA}`, {
    token: tokenC,
    expected: 200,
    note: "ตัวควบคุม: ต้องผ่าน ไม่งั้นแปลว่าปฏิเสธมั่วไปหมด",
    ...p2,
  });

  await call("🔴 ผู้ป่วย A ขอข้อมูลผู้ป่วย B", "GET", `/api/patients/${idB}`, { token: tokenA, expected: 403, ...p2 });
  await call("🔴 ผู้ป่วย A ขอรายชื่อผู้ป่วยทั้งหมด", "GET", "/api/patients", { token: tokenA, expected: 403, ...p2 });
  await call("🔴 ผู้ป่วย A เปิดรายชื่อผู้ใช้แอป", "GET", "/api/users/app-users", {
    token: tokenA,
    expected: 403,
    note: "มีเบอร์โทรของผู้ป่วยและผู้ดูแลทุกคนในคลินิก รั่วทีเดียวหมด",
    ...p2,
  });
  await call("🔴 ผู้ป่วย A เปิดทะเบียนผู้ป่วยรวม", "GET", "/api/dashboard/roster", {
    token: tokenA,
    expected: 403,
    note: "ทะเบียนรวมมีข้อมูลผู้ป่วยทุกคนในคลินิก รั่วทีเดียวหมดทั้งคลินิก",
    ...p2,
  });
  await call("🔴 ผู้ดูแล C เปิดทะเบียนผู้ป่วยรวม", "GET", "/api/dashboard/roster", {
    token: tokenC,
    expected: 403,
    ...p2,
  });
  await call("🔴 ผู้ป่วย A เปิด dashboard ของตัวเอง", "GET", `/api/patients/${idA}/dashboard/summary`, {
    token: tokenA,
    expected: 403,
    note: "dashboard เป็นของ staff เท่านั้น แม้จะเป็นข้อมูลตัวเอง",
    ...p2,
  });
  await call("🔴 ผู้ดูแล C ขอใบสั่งยาของผู้ป่วย B", "GET", `/api/patients/${idB}/prescriptions`, {
    token: tokenC,
    expected: 403,
    ...p2,
  });
  await call("🔴 ผู้ป่วย B ดู round ของผู้ป่วย A", "GET", `/api/rounds/${roundId}`, { token: tokenB, expected: 403, ...p2 });
  if (roundId && firstCode) {
    await call("🔴 ผู้ป่วย B ตอบคำถามใน round ของ A", "PUT", `/api/rounds/${roundId}/responses/${firstCode}`, {
      token: tokenB,
      body: { skipped: true },
      expected: 403,
      ...p2,
    });
  }
  await call("🔴 ผู้ป่วย A เพิ่มยาเข้าคลัง", "POST", "/api/medications", {
    token: tokenA,
    body: { id: "MED-998", drug_name: "should not be created" },
    expected: 403,
    ...p2,
  });
  await call("🔴 ผู้ป่วย A สร้างบัญชี admin", "POST", "/api/auth/provision", {
    token: tokenA,
    body: actor("evil", "admin"),
    expected: 403,
    ...p2,
  });
  await call("🔴 ไม่มี token", "GET", "/api/auth/me", { expected: 401, ...p2 });
  await call("🔴 token ปลอม", "GET", "/api/auth/me", {
    token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIiwicm9sZSI6ImFkbWluIn0.not-a-real-signature",
    expected: 401,
    ...p2,
  });

  await runRedFlagPhase({ patientA: tokenA, patientB: tokenB, doctor: tokenDoctor, patientAId: idA });
  await runEventLogPhase({ patientA: tokenA, patientB: tokenB, doctor: tokenDoctor, patientAId: idA });
  await runSelfBookingPhase({
    patientA: tokenA,
    patientB: tokenB,
    doctor: tokenDoctor,
    patientAId: idA,
    doctorId,
  });
  await runFallRiskPhase({ patientA: tokenA, doctor: tokenDoctor, patientAId: idA });

  const sessions = await runSupabaseAuthPhase(adminToken, idB);
  await runWebPhase(sessions);
  report();
}

/**
 * เฟส 3 — เส้นทาง Supabase Auth (I-1)
 *
 * สร้างบัญชี staff ผ่าน /auth/provision แบบใหม่ (ส่ง email มาด้วย) แล้วล็อกอินกับ Supabase
 * โดยตรงเพื่อเอา token จริงมายิง API ของเรา — พิสูจน์ทั้งท่อ ตั้งแต่สร้างบัญชี 2 ที่ ไปจนถึง
 * requireAuth ตรวจ token ด้วย JWKS แล้วค้นโปรไฟล์ด้วย auth_uid
 *
 * ที่สำคัญไม่แพ้กันคือ RBAC ต้องทำงานเหมือนเดิมทุกประการบนเส้นทางใหม่ — ถ้าเส้นทางนี้หลุด
 * การแยกข้อมูลผู้ป่วย จะเป็นรูโหว่ที่ร้ายแรงกว่าทุกอย่างที่เจอมา
 */
async function runSupabaseAuthPhase(
  adminToken: string,
  otherPatientId: string | undefined
): Promise<{ doctor: SupabaseSession; patient: SupabaseSession } | null> {
  const p3 = { phase: 3 as const };
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    steps.push({
      phase: 3,
      label: "ข้ามเฟส 3",
      method: "-",
      path: "-",
      expected: 0,
      actual: null,
      ok: true,
      note: "ไม่พบ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ใน .env",
    });
    return null;
  }

  const password = `SupabaseSmoke-${RUN_ID}!`;
  const doctorEmail = `smoke_sbdoc_${RUN_ID}@example.test`;
  const patientEmail = `smoke_sbpat_${RUN_ID}@example.test`;

  await call("provision หมอ พร้อมอีเมล (สร้าง 2 ที่)", "POST", "/api/auth/provision", {
    token: adminToken,
    body: { ...actor("sbdoc", "doctor"), email: doctorEmail, password },
    expected: 201,
    ...p3,
  });
  await call("provision ผู้ป่วย พร้อมอีเมล", "POST", "/api/auth/provision", {
    token: adminToken,
    body: { ...actor("sbpat", "patient"), email: patientEmail, password },
    expected: 201,
    ...p3,
  });

  const doctorSession = await supabaseSignIn({ email: doctorEmail }, password);
  const patientSession = await supabaseSignIn({ email: patientEmail }, password);
  steps.push({
    phase: 3,
    label: "ล็อกอินกับ Supabase โดยตรง (เหมือนที่เว็บทำ)",
    method: "POST",
    path: "/auth/v1/token",
    expected: 200,
    actual: doctorSession && patientSession ? 200 : null,
    ok: Boolean(doctorSession && patientSession),
    note: doctorSession && patientSession ? undefined : "ขอ token ไม่สำเร็จ",
  });
  if (!doctorSession || !patientSession) return null;
  const doctorToken = doctorSession.access_token;
  const patientToken = patientSession.access_token;

  await call("🎯 ใช้ token ของ Supabase เรียก /auth/me", "GET", "/api/auth/me", {
    token: doctorToken,
    expected: 200,
    note: "พิสูจน์ JWKS + ค้นโปรไฟล์ด้วย auth_uid",
    ...p3,
  });
  await call("หมอ (Supabase) ดูรายชื่อผู้ป่วย", "GET", "/api/patients?limit=5", {
    token: doctorToken,
    expected: 200,
    ...p3,
  });
  await call("หมอ (Supabase) เปิด dashboard", "GET", `/api/patients/${otherPatientId}/dashboard/summary`, {
    token: doctorToken,
    expected: 200,
    ...p3,
  });

  await call("🔴 ผู้ป่วย (Supabase) ขอรายชื่อผู้ป่วยทั้งหมด", "GET", "/api/patients", {
    token: patientToken,
    expected: 403,
    note: "RBAC ต้องทำงานเหมือนกันทั้งสองเส้นทาง",
    ...p3,
  });
  await call("🔴 ผู้ป่วย (Supabase) ขอข้อมูลผู้ป่วยอื่น", "GET", `/api/patients/${otherPatientId}`, {
    token: patientToken,
    expected: 403,
    ...p3,
  });

  // แก้ตัวอักษรท้าย token ทำให้ลายเซ็นไม่ตรง — ต้องถูกปฏิเสธก่อนไปแตะฐานข้อมูล
  const tampered = doctorToken.slice(0, -2) + (doctorToken.endsWith("A") ? "B" : "A");
  await call("🔴 token ของ Supabase ที่ถูกแก้", "GET", "/api/auth/me", {
    token: tampered,
    expected: 401,
    ...p3,
  });

  return { doctor: doctorSession, patient: patientSession };
}

/**
 * เฟส 4 — เว็บ staff กันคนที่ไม่ใช่บุคลากรได้จริงไหม
 *
 * เฟส 1-3 ยิงแต่ backend พอร์ต 3000 ไม่เคยแตะเว็บพอร์ต 3001 เลย เฟสนี้ปิดช่องว่างนั้น
 * โดยแกล้งทำเป็นเบราว์เซอร์ที่ล็อกอินค้างอยู่ — เว็บอ่านตัวตนจาก cookie ไม่ใช่ header
 * เพราะ token ถูกเก็บไว้ให้ JavaScript ฝั่ง client แตะไม่ได้ (กันถูกขโมยถ้ามี XSS)
 *
 * ⚠️ รูปแบบ cookie เป็นรายละเอียดภายในของ @supabase/ssr ไม่ใช่สัญญาที่รับประกันว่าจะไม่เปลี่ยน
 * ถ้าวันหนึ่งเปลี่ยน เว็บจะอ่าน cookie ที่เราประกอบไม่ออก แล้วเด้งไปหน้า login — ซึ่ง "ดูเหมือน
 * ถูกบล็อก" ทั้งที่จริงแค่กลไกทดสอบพัง เทสต์จะเขียวโดยไม่ได้พิสูจน์อะไรเลย
 *
 * เคสแรกจึงเป็น "ตัวควบคุม": ใช้กลไก cookie เดียวกันเป๊ะกับบัญชีหมอ แล้วต้องเห็นรายชื่อผู้ป่วย
 * ถ้าตัวควบคุมไม่ผ่าน = กลไกพัง = ผลของเคสที่เหลือไม่มีความหมาย
 */
async function runWebPhase(sessions: { doctor: SupabaseSession; patient: SupabaseSession } | null) {
  const skip = (note: string): void => {
    steps.push({
      phase: 4,
      label: "ข้ามเฟส 4",
      method: "-",
      path: "-",
      expected: 0,
      actual: null,
      ok: true,
      note,
    });
  };

  if (!sessions) return skip("เฟส 3 ไม่สำเร็จ จึงไม่มี session ให้ทดสอบ");

  const projectRef = (process.env.SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!projectRef) return skip("อ่าน project ref จาก SUPABASE_URL ไม่ได้");

  // เว็บต้องรันอยู่ ไม่งั้นข้ามพร้อมบอกเหตุผล — ไม่ใช่รายงานว่าผ่าน
  try {
    await fetch(`${WEB_BASE_URL}/auth/login`, { redirect: "manual" });
  } catch {
    return skip(`เว็บไม่ได้รันที่ ${WEB_BASE_URL} — สั่ง npm run dev ในโฟลเดอร์ pdlife-web ก่อน`);
  }

  /** ประกอบ cookie แบบเดียวกับที่ @supabase/ssr เขียนไว้ให้เบราว์เซอร์ */
  function sessionCookie(session: SupabaseSession): string {
    const encoded = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
    const name = `sb-${projectRef}-auth-token`;
    // ค่ายาวเกินขนาด cookie เดียวจะถูกหั่นเป็น .0 .1 … เหมือนที่ไลบรารีทำ
    const MAX = 3180;
    if (encoded.length <= MAX) return `${name}=${encoded}`;
    const chunks: string[] = [];
    for (let i = 0; i < encoded.length; i += MAX) chunks.push(encoded.slice(i, i + MAX));
    return chunks.map((c, i) => `${name}.${i}=${c}`).join("; ");
  }

  async function openAsUser(path: string, session: SupabaseSession | null) {
    const res = await fetch(`${WEB_BASE_URL}${path}`, {
      headers: session ? { Cookie: sessionCookie(session) } : {},
      redirect: "manual",
    });
    return { status: res.status, html: await res.text(), location: res.headers.get("location") };
  }

  /**
   * ตรวจจากเนื้อหา HTML จริง ไม่ใช่แค่ status — หน้าอาจตอบ 200 แต่ข้างในมีของที่ไม่ควรเห็น
   * จึงต้องบอกใน expectedLabel ว่า "ผ่าน" ในเคสนี้แปลว่าอะไร ไม่งั้นอ่านรายงานแล้วเข้าใจผิด
   */
  function record(
    label: string,
    path: string,
    ok: boolean,
    status: number,
    expectedLabel: string,
    note?: string
  ) {
    steps.push({ phase: 4, label, method: "GET", path, expected: 0, expectedLabel, actual: status, ok, note });
  }

  const LIST_HEADING = "ผู้ป่วยในความดูแล";
  const DENIED_TEXT = "สำหรับแพทย์ พยาบาล";
  const DASHBOARD_HEADING = "สัญญาณเตือน";

  const asDoctor = await openAsUser("/staff", sessions.doctor);
  const controlOk = asDoctor.status === 200 && asDoctor.html.includes(LIST_HEADING);
  record(
    "ตัวควบคุม: หมอเปิด /staff แล้วเห็นรายชื่อผู้ป่วย",
    "/staff",
    controlOk,
    asDoctor.status,
    "เห็นรายชื่อผู้ป่วย",
    controlOk ? undefined : "กลไก cookie ใช้ไม่ได้ — ผลของเคสที่เหลือไม่มีความหมาย"
  );
  if (!controlOk) return;

  const asPatient = await openAsUser("/staff", sessions.patient);
  record(
    "🔴 ผู้ป่วยเปิด /staff",
    "/staff",
    !asPatient.html.includes(LIST_HEADING) && asPatient.html.includes(DENIED_TEXT),
    asPatient.status,
    "ถูกบล็อก ไม่เห็นรายชื่อ",
    asPatient.html.includes(LIST_HEADING) ? "เห็นรายชื่อผู้ป่วย — ข้อมูลรั่ว!" : undefined
  );

  const patientOnDashboard = await openAsUser(`/staff/patients/${sessions.doctor.user?.id ?? "x"}`, sessions.patient);
  record(
    "🔴 ผู้ป่วยเปิดหน้า dashboard ของคนอื่น",
    "/staff/patients/…",
    !patientOnDashboard.html.includes(DASHBOARD_HEADING),
    patientOnDashboard.status,
    "ไม่เห็น dashboard",
    patientOnDashboard.html.includes(DASHBOARD_HEADING) ? "เห็น dashboard — ข้อมูลรั่ว!" : undefined
  );

  const anonymous = await openAsUser("/staff", null);
  record(
    "🔴 ไม่มี cookie เลย",
    "/staff",
    anonymous.status === 307 && (anonymous.location ?? "").includes("/auth/login"),
    anonymous.status,
    "307 → /auth/login",
    anonymous.status === 307 ? undefined : "ไม่ได้เด้งไปหน้าล็อกอิน"
  );
}

/**
 * เฟส 5 — สัญญาณเตือนความปลอดภัย เดินครบวงจร
 *
 * ที่ผ่านมาเราพิสูจน์ได้แค่ว่า "คำถามถูกถาม" แต่ไม่เคยพิสูจน์ว่า "ตอบแล้วเตือนถึงหมอ"
 * ตาราง red_flags ว่างเปล่ามาตลอดอายุโปรเจกต์ เฟสนี้เดินเส้นทางเดียวที่สำคัญที่สุด
 * ตั้งแต่ต้นจนจบ: ผู้ป่วยตอบ -> ประตูเปิดคำถามความปลอดภัย -> ยิงธง -> หมอเห็นบนจอ
 *
 * ต้องสร้าง round ของ EVENING_DAILY_CORE ตรงเข้าฐานข้อมูล เพราะ API สร้างได้แต่ ADHOC_CONCERN
 * (ซึ่งมีคำถามเดียว) ส่วน round ตอนเย็นมาจาก scheduler ที่ผูกกับเวลาจริงและวันนัด — พึ่งไม่ได้
 * ในเทสต์ที่รันเวลาไหนก็ได้ ทุกอย่างที่ "ทดสอบ" จริง ๆ ยังวิ่งผ่าน API ตามปกติ
 */
async function runRedFlagPhase(ctx: {
  patientA?: string;
  patientB?: string;
  doctor?: string;
  patientAId?: string;
}) {
  const p5 = { phase: 5 as const };
  const skip = (why: string) => {
    steps.push({
      phase: 5, label: `ข้ามเฟส 5 — ${why}`, method: "-", path: "-",
      expected: 0, actual: null, ok: false,
    });
  };

  if (!ctx.patientA || !ctx.doctor || !ctx.patientAId) return skip("ไม่มี token จากเฟส 1");
  if (!SUPABASE_URL || !SUPABASE_KEY) return skip("ไม่มีค่า SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");

  const db = async (method: string, path: string, body?: unknown) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Profile": "pdlife",
        "Accept-Profile": "pdlife",
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  // --- เตรียม round ตอนเย็น ---
  const created = await db("POST", "round_instances", {
    patient_id: ctx.patientAId,
    template_code: "EVENING_DAILY_CORE",
    scheduled_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  const createdRows = (await created.json().catch(() => null)) as any;
  const roundId = createdRows?.[0]?.id as string | undefined;
  if (!roundId) return skip("สร้าง round EVENING_DAILY_CORE ไม่สำเร็จ");

  const MOOD = "MOOD_DEPRESSED_ANHEDONIA";
  const SAFETY = "MOOD_SUICIDAL_IDEATION";
  const visible = async (label: string) => {
    const r = await call(label, "GET", `/api/rounds/${roundId}/questions`, {
      token: ctx.patientA, expected: 200, ...p5,
    });
    return ((r.json?.questions ?? []) as any[]).map((q) => q.question_code);
  };

  // --- ประตูต้องปิดอยู่ก่อน ---
  const before = await visible("ดูคำถามก่อนตอบเรื่องอารมณ์");
  const closed = !before.includes(SAFETY);
  steps[steps.length - 1].ok = closed;
  steps[steps.length - 1].note = closed
    ? `ยังไม่ถาม ${SAFETY} — ถูกต้อง (ได้ ${before.length} คำถาม)`
    : `🔴 ถาม ${SAFETY} ทั้งที่ยังไม่ได้ตอบเรื่องซึมเศร้า`;

  // --- ตอบซึมเศร้าถึงเกณฑ์ ---
  await call(`ผู้ป่วยตอบซึมเศร้าระดับ 2`, "PUT", `/api/rounds/${roundId}/responses/${MOOD}`, {
    token: ctx.patientA,
    body: { answer_value: { choice: "2" }, submitted_at: new Date().toISOString() },
    expected: 200,
    ...p5,
  });

  // --- ประตูต้องเปิด ---
  const after = await visible("ดูคำถามหลังตอบซึมเศร้า");
  const opened = after.includes(SAFETY);
  steps[steps.length - 1].ok = opened;
  steps[steps.length - 1].note = opened
    ? `เปิดคำถาม ${SAFETY} แล้ว — ประตูความปลอดภัยทำงาน`
    : `🔴 ไม่ถาม ${SAFETY} ทั้งที่ซึมเศร้าถึงเกณฑ์ — ประตูความปลอดภัยพัง`;

  // --- ตอบคำถามความปลอดภัย ---
  await call("ผู้ป่วยตอบว่าคิดทำร้ายตัวเอง 'มีบ่อย'", "PUT", `/api/rounds/${roundId}/responses/${SAFETY}`, {
    token: ctx.patientA,
    body: { answer_value: { choice: "often" }, submitted_at: new Date().toISOString() },
    expected: 200,
    ...p5,
  });

  // --- หมอต้องเห็น ---
  const seen = await call("หมอเปิดดูสัญญาณเตือน", "GET", `/api/patients/${ctx.patientAId}/red-flags`, {
    token: ctx.doctor, expected: 200, ...p5,
  });
  const flags = (seen.json?.flags ?? []) as any[];
  const flag = flags.find((f) => f.clinic_tag === "suicidal_ideation");
  if (!flag) {
    steps[steps.length - 1].ok = false;
    steps[steps.length - 1].note = `🔴 ผู้ป่วยตอบไปแล้ว แต่หมอไม่เห็นธงเลย (ได้ ${flags.length} รายการ)`;
  } else {
    // ธงบอกแค่ว่า "เกี่ยวกับการทำร้ายตัวเอง" ยังไม่พอ หมอต้องรู้ว่าตอบว่าอะไร
    const complete = flag.severity === "urgent" && flag.answer_th === "มีบ่อย" && flag.question_th;
    steps[steps.length - 1].ok = complete;
    steps[steps.length - 1].note = complete
      ? `เห็น urgent · คำตอบ "${flag.answer_th}" · มีข้อความคำถามครบ`
      : `ข้อมูลไม่ครบ: severity=${flag.severity} answer_th=${JSON.stringify(flag.answer_th)}`;
  }

  // --- กดรับทราบ ---
  const flagId = flag?.id as string | undefined;
  if (flagId) {
    await call("🔴 ผู้ป่วยกดรับทราบธงของตัวเอง", "PATCH", `/api/red-flags/${flagId}/review`, {
      token: ctx.patientA,
      body: { reviewed: true },
      expected: 403,
      note: "ถ้าผู้ป่วยปิดสัญญาณเตือนตัวเองได้ ธงจะหายก่อนที่พยาบาลจะเห็น",
      ...p5,
    });

    await call("หมอกดรับทราบ", "PATCH", `/api/red-flags/${flagId}/review`, {
      token: ctx.doctor,
      body: { reviewed: true },
      expected: 200,
      ...p5,
    });

    const after = await call("ธงที่รับทราบแล้วต้องหลุดจากรายการ 'ยังไม่มีใครดู'", "GET",
      `/api/patients/${ctx.patientAId}/red-flags?reviewed=false`, { token: ctx.doctor, expected: 200, ...p5 });
    const stillThere = ((after.json?.flags ?? []) as any[]).some((f) => f.id === flagId);
    steps[steps.length - 1].ok = !stillThere;
    steps[steps.length - 1].note = stillThere
      ? "🔴 กดรับทราบแล้วแต่ยังค้างอยู่ในรายการที่ยังไม่มีใครดู"
      : "หลุดออกจากรายการแล้ว — พยาบาลจะไม่เห็นซ้ำ";

    const undone = await call("ยกเลิกการรับทราบได้ (กรณีกดผิด)", "PATCH", `/api/red-flags/${flagId}/review`, {
      token: ctx.doctor,
      body: { reviewed: false },
      expected: 200,
      ...p5,
    });
    const cleared = undone.json?.flag?.reviewed === false && undone.json?.flag?.reviewed_by === null;
    steps[steps.length - 1].ok = cleared;
    steps[steps.length - 1].note = cleared
      ? "กลับมาเป็นยังไม่รับทราบ และล้างชื่อผู้กดแล้ว"
      : `ยกเลิกไม่สมบูรณ์: ${JSON.stringify(undone.json?.flag)}`;

    await call("🔴 กดรับทราบธงที่ไม่มีอยู่จริง", "PATCH",
      "/api/red-flags/00000000-0000-0000-0000-000000000000/review", {
      token: ctx.doctor, body: { reviewed: true }, expected: 404, ...p5,
    });
  }

  // --- ใครห้ามเห็น ---
  await call("🔴 ผู้ป่วยดูสัญญาณเตือนของตัวเอง", "GET", `/api/patients/${ctx.patientAId}/red-flags`, {
    token: ctx.patientA,
    expected: 403,
    note: "เด้งกลับไปบอกผู้ป่วยว่าถูกทำเครื่องหมายว่าเสี่ยง = อันตรายทางคลินิก",
    ...p5,
  });
  if (ctx.patientB) {
    await call("🔴 ผู้ป่วยอื่นดูสัญญาณเตือนของ A", "GET", `/api/patients/${ctx.patientAId}/red-flags`, {
      token: ctx.patientB, expected: 403, ...p5,
    });
  }
  await call("🔴 ไม่มี token", "GET", `/api/patients/${ctx.patientAId}/red-flags`, { expected: 401, ...p5 });

  // --- เก็บกวาด ---
  // ธง suicidal_ideation ของปลอมค้างในฐานข้อมูลอันตรายกว่าตารางรก: วันหนึ่งมีคนเปิดดูแล้ว
  // นึกว่าเป็นผู้ป่วยจริง responses/round ลบตามด้วย ON DELETE CASCADE
  const del = await db("DELETE", `round_instances?id=eq.${roundId}`);
  steps.push({
    phase: 5,
    label: "ลบข้อมูลทดสอบทิ้ง (ธง + คำตอบ + round)",
    method: "DELETE",
    path: "round_instances",
    expected: [200, 204],
    actual: del.status,
    ok: del.status < 300,
    note: del.status < 300 ? undefined : "ลบไม่สำเร็จ — ต้องตามลบเองไม่งั้นธงปลอมค้างในระบบ",
  });
}

/**
 * เฟส 6 — event_logs -> red flag ครบวงจรจริง
 *
 * event_logs เพิ่งต่อสายวันนี้ (§6.3 — เหตุฉุกเฉินนอกรอบคำถาม) ไม่เคยมีข้อมูลจริงในตาราง
 * เลยสักแถว เฟสนี้พิสูจน์สองเส้นทางที่เทสหน่วย (tests/eventLog.test.ts) พิสูจน์ไม่ได้เพราะ
 * ไม่แตะ DB จริง: severity "severe" ยิงเป็น red flag "red" ได้จริง และ required_er=true
 * ชนะ severity เดิมได้จริงในตารางจริง (ไม่ใช่แค่ pure function คืนค่าถูก)
 */
async function runEventLogPhase(ctx: {
  patientA?: string;
  patientB?: string;
  doctor?: string;
  patientAId?: string;
}) {
  const p6 = { phase: 6 as const };
  const skip = (why: string) => {
    steps.push({
      phase: 6, label: `ข้ามเฟส 6 — ${why}`, method: "-", path: "-",
      expected: 0, actual: null, ok: false,
    });
  };

  if (!ctx.patientA || !ctx.patientB || !ctx.doctor || !ctx.patientAId) return skip("ไม่มี token จากเฟส 1");
  if (!SUPABASE_URL || !SUPABASE_KEY) return skip("ไม่มีค่า SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");

  const db = async (method: string, path: string) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Profile": "pdlife",
        "Accept-Profile": "pdlife",
      },
    });

  const eventLogIds: string[] = [];

  // --- ผู้ป่วย A รายงานเหตุการณ์ severe ---
  const created = await call("ผู้ป่วย A รายงานเหตุการณ์สำลัก (severe)", "POST",
    `/api/patients/${ctx.patientAId}/event-logs`, {
    token: ctx.patientA,
    body: {
      event_type: "choking",
      severity: "severe",
      occurred_at: new Date().toISOString(),
    },
    expected: 201,
    ...p6,
  });
  const eventLogId = created.json?.event_log?.id as string | undefined;
  if (eventLogId) eventLogIds.push(eventLogId);

  await call("ผู้ป่วย A เห็นเหตุการณ์ตัวเองในรายการ", "GET",
    `/api/patients/${ctx.patientAId}/event-logs`, {
    token: ctx.patientA, expected: 200, ...p6,
  });

  // --- หมอต้องเห็น red flag ที่ยิงอัตโนมัติ (severe -> red) ---
  const seen = await call("หมอเปิดดูสัญญาณเตือน (หา choking)", "GET",
    `/api/patients/${ctx.patientAId}/red-flags`, {
    token: ctx.doctor, expected: 200, ...p6,
  });
  const chokingFlag = ((seen.json?.flags ?? []) as any[]).find((f) => f.clinic_tag === "choking");
  if (!chokingFlag) {
    steps[steps.length - 1].ok = false;
    steps[steps.length - 1].note = "🔴 รายงาน severe แล้ว แต่หมอไม่เห็นธง choking เลย";
  } else {
    const ok = chokingFlag.severity === "red";
    steps[steps.length - 1].ok = ok;
    steps[steps.length - 1].note = ok
      ? "เห็นธง choking severity=red ตามกติกา severe->red"
      : `🔴 severity ควรเป็น red แต่ได้ ${chokingFlag.severity}`;
  }

  // --- required_er=true ต้องชนะ severity เดิม (moderate เฉยๆ ไม่ควรยิงธงเลย) ---
  const created2 = await call("ผู้ป่วย A รายงานเหตุการณ์ moderate แต่ required_er=true", "POST",
    `/api/patients/${ctx.patientAId}/event-logs`, {
    token: ctx.patientA,
    body: {
      event_type: "medication_no_effect",
      severity: "moderate",
      required_er: true,
      occurred_at: new Date().toISOString(),
    },
    expected: 201,
    ...p6,
  });
  const eventLogId2 = created2.json?.event_log?.id as string | undefined;
  if (eventLogId2) eventLogIds.push(eventLogId2);

  const seen2 = await call("หมอเปิดดูสัญญาณเตือน (หา medication_no_effect)", "GET",
    `/api/patients/${ctx.patientAId}/red-flags`, {
    token: ctx.doctor, expected: 200, ...p6,
  });
  const erFlag = ((seen2.json?.flags ?? []) as any[]).find((f) => f.clinic_tag === "medication_no_effect");
  if (!erFlag) {
    steps[steps.length - 1].ok = false;
    steps[steps.length - 1].note = "🔴 required_er=true ควรยิงธงแม้ severity เป็น moderate แต่ไม่เห็นธงเลย";
  } else {
    const ok = erFlag.severity === "urgent";
    steps[steps.length - 1].ok = ok;
    steps[steps.length - 1].note = ok
      ? "required_er=true ชนะ severity moderate -> ยิงเป็น urgent ถูกต้อง"
      : `🔴 severity ควรเป็น urgent (required_er ชนะ) แต่ได้ ${erFlag.severity}`;
  }

  // --- ใครห้ามทำ ---
  await call("🔴 ผู้ป่วย B รายงานเหตุการณ์แทนผู้ป่วย A", "POST",
    `/api/patients/${ctx.patientAId}/event-logs`, {
    token: ctx.patientB,
    body: { event_type: "choking", severity: "severe", occurred_at: new Date().toISOString() },
    expected: 403,
    note: "ต้องกันด้วย assertCanAccessPatient แม้จะยังไม่ผูก caregiver link",
    ...p6,
  });
  await call("🔴 หมอบันทึกเหตุการณ์แทนผู้ป่วย", "POST",
    `/api/patients/${ctx.patientAId}/event-logs`, {
    token: ctx.doctor,
    body: { event_type: "choking", severity: "severe", occurred_at: new Date().toISOString() },
    expected: 403,
    note: "รอบนี้เปิดให้ผู้ป่วย/ผู้ดูแลรายงานเองเท่านั้น เจ้าหน้าที่คีย์แทนยังไม่ทำ",
    ...p6,
  });
  await call("🔴 ผู้ป่วย B ดูเหตุการณ์ของผู้ป่วย A", "GET",
    `/api/patients/${ctx.patientAId}/event-logs`, {
    token: ctx.patientB, expected: 403, ...p6,
  });

  // --- เก็บกวาด ---
  // ลบ event_logs พอ — red_flags.event_log_id เป็น ON DELETE CASCADE (migration 0001
  // บรรทัด 517) จึงลบธงที่ผูกไว้ตามให้อัตโนมัติ ไม่ต้องลบสองรอบ
  for (const id of eventLogIds) {
    const del = await db("DELETE", `event_logs?id=eq.${id}`);
    steps.push({
      phase: 6,
      label: `ลบเหตุการณ์ทดสอบทิ้ง (${id.slice(0, 8)}…)`,
      method: "DELETE",
      path: "event_logs",
      expected: [200, 204],
      actual: del.status,
      ok: del.status < 300,
      note: del.status < 300 ? undefined : "ลบไม่สำเร็จ — ต้องตามลบเองไม่งั้นเหตุการณ์/ธงปลอมค้างในระบบ",
    });
  }
}

/**
 * เฟส 7 — จองนัดเอง: ดู slot ว่าง -> จอง -> หมอเห็นในตารางจริง -> ชนกันแล้ว 409 จริง
 *
 * ทีมแอปยืนยันแล้วว่าจะปรับ UI ให้ตรงกับ contract นี้ (docs/HANDOVER.md ข้อ 3) เฟสนี้พิสูจน์
 * ว่า available-slots สะท้อนของจริงหลังจอง (ไม่ใช่แค่คำนวณ grid เฉยๆ), นัดที่จองเองโผล่ใน
 * ตารางนัดของ staff ได้จริง (endpoint เดิมที่ staff ใช้อยู่ทุกวัน), และช่องชนกันจริงยังกันได้
 * ผ่านเส้นทางใหม่นี้ด้วย ไม่ใช่แค่เส้นทางเดิมของ staff — เทสหน่วยพิสูจน์ pure function ได้
 * แต่พิสูจน์ไม่ได้ว่า route ต่อกับ DB จริงถูกทุกจุด
 */
async function runSelfBookingPhase(ctx: {
  patientA?: string;
  patientB?: string;
  doctor?: string;
  patientAId?: string;
  doctorId?: string;
}) {
  const p7 = { phase: 7 as const };
  const skip = (why: string) => {
    steps.push({
      phase: 7, label: `ข้ามเฟส 7 — ${why}`, method: "-", path: "-",
      expected: 0, actual: null, ok: false,
    });
  };

  if (!ctx.patientA || !ctx.patientB || !ctx.doctor || !ctx.patientAId || !ctx.doctorId) {
    return skip("ไม่มี token/doctorId จากเฟส 1");
  }

  // วันไกลจากปัจจุบันมากพอที่จะไม่ชนกับนัดอื่นที่รันสร้างไว้ก่อนหน้า (ไม่ลบข้อมูลทดสอบเก่าตามกฎ
  // โปรเจกต์ — ดู runRedFlagPhase/runEventLogPhase) กระจายวันตาม RUN_ID กันชนกันเองข้ามรอบรัน
  const daysAhead = 400 + (parseInt(RUN_ID, 36) % 200);
  const targetDate = new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);

  // --- ดู slot ว่างก่อนจอง (ทั้งเฟส 1 หมอคนนี้ยังไม่เคยมีนัดวันนี้) ---
  const before = await call("ดู slot ว่างของหมอวันนั้น (ก่อนจอง)", "GET",
    `/api/appointments/available-slots?doctor_id=${ctx.doctorId}&date=${targetDate}`, {
    token: ctx.patientA, expected: 200, ...p7,
  });
  const slotsBefore = (before.json?.slots ?? []) as Array<{ time: string; available: boolean }>;
  const freeSlot = slotsBefore.find((s) => s.available)?.time;
  if (!freeSlot) {
    steps[steps.length - 1].ok = false;
    steps[steps.length - 1].note = "🔴 ไม่มี slot ว่างเลยในวันที่เพิ่งเลือกมาใหม่ — ผิดปกติ";
    return;
  }
  steps[steps.length - 1].note = `เลือกช่อง ${freeSlot} ไปจองต่อ (ว่าง ${slotsBefore.filter((s) => s.available).length}/${slotsBefore.length} ช่อง)`;

  // --- ผู้ป่วย A จองเอง ---
  const booked = await call(`ผู้ป่วย A จองนัดเอง (${freeSlot})`, "POST",
    `/api/patients/${ctx.patientAId}/appointments`, {
    token: ctx.patientA,
    body: { doctor_id: ctx.doctorId, visit_date: targetDate, visit_time: freeSlot, visit_type: "follow_up" },
    expected: 201,
    ...p7,
  });
  const appointmentId = booked.json?.appointment?.id as string | undefined;

  // --- slot ที่จองไปต้องขึ้นไม่ว่างแล้วจริง ---
  const after = await call("ดู slot ว่างของหมอวันนั้น (หลังจอง)", "GET",
    `/api/appointments/available-slots?doctor_id=${ctx.doctorId}&date=${targetDate}`, {
    token: ctx.patientA, expected: 200, ...p7,
  });
  const afterSlot = ((after.json?.slots ?? []) as Array<{ time: string; available: boolean }>)
    .find((s) => s.time === freeSlot);
  const closedCorrectly = afterSlot?.available === false;
  steps[steps.length - 1].ok = closedCorrectly;
  steps[steps.length - 1].note = closedCorrectly
    ? `${freeSlot} ขึ้นไม่ว่างแล้วถูกต้อง`
    : `🔴 ${freeSlot} ควรขึ้นไม่ว่างแล้ว แต่ได้ available=${afterSlot?.available}`;

  // --- หมอ (staff) ต้องเห็นนัดนี้ในตารางนัดจริงของวันนั้น ---
  const schedule = await call("หมอเปิดตารางนัดวันนั้น (ต้องเห็นนัดที่จองเอง)", "GET",
    `/api/appointments?date=${targetDate}`, {
    token: ctx.doctor, expected: 200, ...p7,
  });
  const onSchedule = ((schedule.json?.appointments ?? []) as any[])
    .find((a) => a.id === appointmentId);
  if (!onSchedule) {
    steps[steps.length - 1].ok = false;
    steps[steps.length - 1].note = "🔴 จองเองสำเร็จ แต่ไม่โผล่ในตารางนัดที่ staff ใช้ดูทุกวัน";
  } else {
    // visit_time จาก /api/appointments เป็น "HH:MM:SS" (คอลัมน์ TIME) ต่างจาก freeSlot ที่มา
    // จาก available-slots ("HH:MM") — ตัดวินาทีทิ้งก่อนเทียบ เหมือน timeLabel() ฝั่งเว็บ
    const correct = onSchedule.patient_id === ctx.patientAId
      && (onSchedule.visit_time as string | null)?.slice(0, 5) === freeSlot
      && onSchedule.status === "scheduled";
    steps[steps.length - 1].ok = correct;
    steps[steps.length - 1].note = correct
      ? "เห็นนัดถูกคน ถูกเวลา สถานะ scheduled"
      : `ข้อมูลไม่ตรง: ${JSON.stringify(onSchedule)}`;
  }

  // --- จองซ้ำช่องเดิมต้องชนจริง (เส้นทางใหม่นี้ก็ต้องกันคิวชนได้เหมือนฟอร์มของ staff) ---
  await call("🔴 ผู้ป่วย A จองซ้ำช่องเดิมที่เพิ่งจองไป", "POST",
    `/api/patients/${ctx.patientAId}/appointments`, {
    token: ctx.patientA,
    body: { doctor_id: ctx.doctorId, visit_date: targetDate, visit_time: freeSlot, visit_type: "follow_up" },
    expected: 409,
    note: "ตัวเองจองซ้ำเวลาเดิม — ต้องชนที่ findByPatientAndSlot",
    ...p7,
  });

  // --- ใครห้ามทำ ---
  await call("🔴 ผู้ป่วย B จองนัดแทนผู้ป่วย A", "POST",
    `/api/patients/${ctx.patientAId}/appointments`, {
    token: ctx.patientB,
    body: { doctor_id: ctx.doctorId, visit_date: targetDate, visit_time: "08:00", visit_type: "follow_up" },
    expected: 403,
    ...p7,
  });
  await call("🔴 หมอ (staff) ใช้ endpoint จองเองของผู้ป่วย", "POST",
    `/api/patients/${ctx.patientAId}/appointments`, {
    token: ctx.doctor,
    body: { doctor_id: ctx.doctorId, visit_date: targetDate, visit_time: "08:00", visit_type: "follow_up" },
    expected: 403,
    note: "endpoint นี้เปิดให้ผู้ป่วย/ผู้ดูแลเท่านั้น — staff มี /api/appointments ของตัวเองอยู่แล้ว",
    ...p7,
  });

  // --- เก็บกวาด: ยกเลิกนัด ไม่ลบ — appointments ไม่มี DELETE โดยตั้งใจ (ดู HANDOVER §6) ---
  if (appointmentId) {
    const cancelled = await call("ยกเลิกนัดทดสอบทิ้ง (ใช้ cancelled แทนลบ)", "PATCH",
      `/api/appointments/${appointmentId}/status`, {
      token: ctx.doctor, body: { status: "cancelled" }, expected: 200, ...p7,
    });
    steps[steps.length - 1].note = cancelled.json?.appointment?.status === "cancelled"
      ? undefined
      : "🔴 ยกเลิกไม่สำเร็จ — นัดทดสอบยังค้างอยู่ในตารางจริง";
  }
}

/**
 * เฟส 8 — MOTOR_FALL_NEAR_FALL (count>=2) + AUTO_ORTHOSTATIC_SYMPTOM (จับคู่กับ MOT-05 ในรอบ
 * เดียวกัน) พิสูจน์กับฐานข้อมูลจริง — เทสหน่วยพิสูจน์ pure function ได้ แต่พิสูจน์ไม่ได้ว่า
 * count ที่ส่งผ่าน HTTP จริงไปถึง validateAndNormalizeAnswer ครบ หรือ listByRound ดึงคำตอบ
 * พี่น้องในรอบจริงมาถูก
 *
 * ต้องสร้าง round ของ EVENING_DAILY_CORE ตรงเข้าฐานข้อมูล เหตุผลเดียวกับ runRedFlagPhase —
 * API สร้างได้แต่ ADHOC_CONCERN
 */
async function runFallRiskPhase(ctx: { patientA?: string; doctor?: string; patientAId?: string }) {
  const p8 = { phase: 8 as const };
  const skip = (why: string) => {
    steps.push({
      phase: 8, label: `ข้ามเฟส 8 — ${why}`, method: "-", path: "-",
      expected: 0, actual: null, ok: false,
    });
  };

  if (!ctx.patientA || !ctx.doctor || !ctx.patientAId) return skip("ไม่มี token จากเฟส 1");
  if (!SUPABASE_URL || !SUPABASE_KEY) return skip("ไม่มีค่า SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");

  const db = async (method: string, path: string, body?: unknown) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Profile": "pdlife",
        "Accept-Profile": "pdlife",
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const newRound = async () => {
    const res = await db("POST", "round_instances", {
      patient_id: ctx.patientAId,
      template_code: "EVENING_DAILY_CORE",
      scheduled_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const rows = (await res.json().catch(() => null)) as any;
    return rows?.[0]?.id as string | undefined;
  };

  const countFlags = async (clinicTag: string): Promise<number> => {
    const r = await call(`นับธง ${clinicTag} ปัจจุบัน`, "GET", `/api/patients/${ctx.patientAId}/red-flags`, {
      token: ctx.doctor, expected: 200, ...p8,
    });
    return ((r.json?.flags ?? []) as any[]).filter((f) => f.clinic_tag === clinicTag).length;
  };

  const roundIds: string[] = [];

  // ─── รอบที่ 1: MOT-05 near_fall count 1->2, แล้วต่อด้วย AUT-01 คะแนนต่ำที่ปกติไม่ยิงเอง ───
  const round1 = await newRound();
  if (!round1) return skip("สร้าง round EVENING_DAILY_CORE ไม่สำเร็จ (รอบที่ 1)");
  roundIds.push(round1);

  const fallRiskBefore = await countFlags("fall_risk");

  await call("MOT-05: near_fall count=1 (ยังไม่ซ้ำ)", "PUT",
    `/api/rounds/${round1}/responses/MOTOR_FALL_NEAR_FALL`, {
    token: ctx.patientA,
    body: { answer_value: { choice: "near_fall", count: 1 }, submitted_at: new Date().toISOString() },
    expected: 200,
    ...p8,
  });
  const fallRiskAfterOne = await countFlags("fall_risk");
  const noFlagYet = fallRiskAfterOne === fallRiskBefore;
  steps[steps.length - 1].ok = noFlagYet;
  steps[steps.length - 1].note = noFlagYet
    ? "count=1 ยังไม่ยิงถูกต้อง"
    : `🔴 count=1 ไม่ควรยิง แต่ธง fall_risk เพิ่มจาก ${fallRiskBefore} เป็น ${fallRiskAfterOne}`;

  await call("MOT-05: near_fall count=2 (ซ้ำแล้ว — ตอบซ้ำในคำถามเดิม upsert ทับ)", "PUT",
    `/api/rounds/${round1}/responses/MOTOR_FALL_NEAR_FALL`, {
    token: ctx.patientA,
    body: { answer_value: { choice: "near_fall", count: 2 }, submitted_at: new Date().toISOString() },
    expected: 200,
    ...p8,
  });
  const fallRiskAfterTwo = await countFlags("fall_risk");
  const flagFired = fallRiskAfterTwo === fallRiskBefore + 1;
  steps[steps.length - 1].ok = flagFired;
  steps[steps.length - 1].note = flagFired
    ? "count=2 ยิงธง fall_risk ใหม่ 1 ใบถูกต้อง"
    : `🔴 count=2 ควรยิงธง fall_risk เพิ่ม 1 ใบ แต่ได้ ${fallRiskBefore} -> ${fallRiskAfterTwo}`;

  const orthostaticBefore = await countFlags("orthostatic_symptom");

  await call("AUT-01: mild_once (score=1 เดี่ยวๆ ไม่พอยิงเอง) แต่รอบนี้มี MOT-05=near_fall จับคู่", "PUT",
    `/api/rounds/${round1}/responses/AUTO_ORTHOSTATIC_SYMPTOM`, {
    token: ctx.patientA,
    body: { answer_value: { choice: "mild_once" }, submitted_at: new Date().toISOString() },
    expected: 200,
    ...p8,
  });
  const orthostaticAfterPaired = await countFlags("orthostatic_symptom");
  const pairedFired = orthostaticAfterPaired === orthostaticBefore + 1;
  steps[steps.length - 1].ok = pairedFired;
  steps[steps.length - 1].note = pairedFired
    ? "จับคู่กับ MOT-05 ในรอบเดียวกันยิงธง orthostatic_symptom แม้ score ไม่ถึงเกณฑ์"
    : `🔴 ควรยิงธง orthostatic_symptom เพิ่ม 1 ใบจากการจับคู่ แต่ได้ ${orthostaticBefore} -> ${orthostaticAfterPaired}`;

  // ─── รอบที่ 2 (แยกรอบ): ไม่มีการล้มเลย — พิสูจน์ว่าไม่ยิงมั่ว ───
  const round2 = await newRound();
  if (round2) {
    roundIds.push(round2);

    await call("รอบใหม่ — MOT-05: none (ไม่ล้มเลย)", "PUT",
      `/api/rounds/${round2}/responses/MOTOR_FALL_NEAR_FALL`, {
      token: ctx.patientA,
      body: { answer_value: { choice: "none" }, submitted_at: new Date().toISOString() },
      expected: 200,
      ...p8,
    });

    await call("🔴 รอบใหม่ — AUT-01: mild_once โดยไม่มีการล้มคู่กัน ต้องไม่ยิงเพิ่ม", "PUT",
      `/api/rounds/${round2}/responses/AUTO_ORTHOSTATIC_SYMPTOM`, {
      token: ctx.patientA,
      body: { answer_value: { choice: "mild_once" }, submitted_at: new Date().toISOString() },
      expected: 200,
      note: "ยิง 200 เพราะ submit ผ่านปกติ — เช็คว่า 'ไม่ยิงธงเพิ่ม' แยกต่างหากด้านล่าง",
      ...p8,
    });
    const orthostaticAfterControl = await countFlags("orthostatic_symptom");
    const noFalsePositive = orthostaticAfterControl === orthostaticAfterPaired;
    steps.push({
      phase: 8,
      label: "🔴 ไม่มีการล้มคู่กัน ธง orthostatic_symptom ต้องไม่เพิ่มขึ้นอีก",
      method: "GET", path: "/api/patients/:id/red-flags",
      expected: orthostaticAfterPaired, actual: orthostaticAfterControl,
      ok: noFalsePositive,
      note: noFalsePositive
        ? "ไม่ยิงมั่วเมื่อไม่มีการล้มจริง"
        : `🔴 ไม่ควรยิงเพิ่ม แต่ธงเพิ่มจาก ${orthostaticAfterPaired} เป็น ${orthostaticAfterControl}`,
    });
  } else {
    skip("สร้าง round EVENING_DAILY_CORE ไม่สำเร็จ (รอบที่ 2 — ข้ามส่วน control)");
  }

  // --- เก็บกวาด: ลบ round ทั้งสอง (responses/red_flags หายตามด้วย ON DELETE CASCADE) ---
  for (const id of roundIds) {
    const del = await db("DELETE", `round_instances?id=eq.${id}`);
    steps.push({
      phase: 8,
      label: `ลบ round ทดสอบทิ้ง (${id.slice(0, 8)}…)`,
      method: "DELETE", path: "round_instances",
      expected: [200, 204], actual: del.status, ok: del.status < 300,
      note: del.status < 300 ? undefined : "ลบไม่สำเร็จ — ต้องตามลบเองไม่งั้นธงปลอมค้างในระบบ",
    });
  }
}

function report() {
  const titles = {
    1: "เส้นทางที่ควรสำเร็จ",
    2: "เส้นทางที่ต้องถูกปฏิเสธ",
    3: "เส้นทาง Supabase Auth (I-1)",
    4: "เว็บ staff กันคนที่ไม่ใช่บุคลากร",
    5: "สัญญาณเตือนความปลอดภัย ครบวงจร",
    6: "event_logs -> red flag ครบวงจร",
    7: "จองนัดเอง ครบวงจร",
    8: "MOT-05 count + AUT-01 จับคู่กับการล้ม ครบวงจร",
  } as const;

  for (const phase of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
    const rows = steps.filter((s) => s.phase === phase);
    if (rows.length === 0) continue;
    console.log(`\n  ${"─".repeat(76)}`);
    console.log(`  เฟส ${phase} — ${titles[phase]}`);
    console.log(`  ${"─".repeat(76)}`);
    for (const s of rows) {
      // เฟส 2 ที่ตอบ 2xx ไม่ใช่แค่ "ไม่ผ่าน" แต่คือช่องโหว่ที่ข้อมูลผู้ป่วยรั่วได้จริง
      const leak = phase === 2 && !s.ok && s.actual !== null && s.actual < 300 && !s.label.startsWith("ผู้ดูแล C ดูข้อมูล");
      const mark = s.ok ? "✅" : leak ? "🔴" : "❌";
      const exp = s.expectedLabel ?? (Array.isArray(s.expected) ? s.expected.join("/") : String(s.expected));
      console.log(
        `  ${mark} ${String(s.actual ?? "—").padStart(3)} (คาด ${String(exp).padEnd(7)}) ${s.label}` +
          (s.note ? `\n         ↳ ${s.note}` : "")
      );
    }
  }

  const failed = steps.filter((s) => !s.ok);
  const leaks = failed.filter((s) => s.phase === 2 && s.actual !== null && s.actual < 300);
  console.log(`\n  ${"─".repeat(76)}`);
  console.log(`  ผ่าน ${steps.length - failed.length}/${steps.length}` + (failed.length ? `  ·  พัง ${failed.length}` : ""));
  if (leaks.length > 0) console.log(`  🔴 ช่องโหว่ความปลอดภัย ${leaks.length} จุด — ข้อมูลผู้ป่วยเข้าถึงข้ามคนได้`);
  console.log("");
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n  สคริปต์ล้ม:", err);
  report();
});
