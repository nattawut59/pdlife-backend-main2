# สเปกการเชื่อมต่อสำหรับแอปมือถือ PDLIFE

เอกสารนี้สำหรับคนที่ทำแอปมือถือ (ผู้ป่วยและผู้ดูแล) — บอกว่าต้องล็อกอินยังไง เรียก API ยังไง และมี endpoint อะไรให้ใช้บ้าง

> **สถานะ ณ 20 ส.ค. 2569** — backend พร้อมรับแล้ว ทดสอบผ่าน 57/57
> **สิ่งที่เปลี่ยนจากที่อาจเคยได้ยินมา: ไม่ใช้ OTP แล้ว** เปลี่ยนเป็นเบอร์โทร + รหัสผ่าน

---

## 1. ภาพรวม — แอปคุยกับ 2 ที่

```
                  (1) ล็อกอิน / สมัคร
   แอปมือถือ ──────────────────────────►  Supabase Auth
        |                                      |
        |  ◄──────── access_token ─────────────+
        |
        |  (2) เรียกข้อมูลทุกอย่าง (แนบ token)
        +──────────────────────────────►  PDLIFE backend (Express)
```

**เรื่องรหัสผ่าน/ล็อกอิน → คุยกับ Supabase โดยตรง**
**เรื่องข้อมูลผู้ป่วยทั้งหมด → คุยกับ backend ของเรา**

> **ห้ามยิง `POST /api/auth/login`** — เป็นเส้นทางเก่าที่กำลังจะถูกลบ ใช้ Supabase แทน

---

## 2. ติดตั้ง

```bash
npm install @supabase/supabase-js react-native-url-polyfill
npm install @react-native-async-storage/async-storage
```

```ts
// lib/supabase.ts
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,    // ต่ออายุ token ให้เอง ไม่ต้องเขียนเอง
      persistSession: true,      // ปิดแอปแล้วยังล็อกอินอยู่
      detectSessionInUrl: false, // ไม่ใช่เว็บ ต้องปิด
    },
  },
);
```

ขอค่า `SUPABASE_URL` และ `PUBLISHABLE_KEY` จากคนดูแล Supabase project (Settings → API)
**ต้องเป็น publishable key เท่านั้น ห้ามใส่ secret key ในแอปเด็ดขาด** — secret key ข้ามการตรวจสิทธิ์ทั้งหมดและอ่านข้อมูลผู้ป่วยได้ทุกคน

### เรื่องที่เก็บ session

`AsyncStorage` ใช้ง่ายแต่ไม่ได้เข้ารหัส ส่วน `expo-secure-store` ปลอดภัยกว่าแต่มีเพดานขนาดต่อรายการ ซึ่ง session ของ Supabase อาจเกินจนต้องหั่นเป็นชิ้น

**ข้อเสนอ:** เริ่มด้วย `AsyncStorage` แล้ว **ล็อกแอปด้วยลายนิ้วมือหรือ PIN ตอนเปิด** ซึ่งกันภัยที่เกิดจริง (มือถือหาย) ได้ตรงจุดกว่า — และลายนิ้วมือใช้ง่ายกว่า PIN มากสำหรับผู้ป่วยที่มืออาจสั่น

---

## 3. เบอร์โทร — จุดที่พลาดกันบ่อยที่สุด

**Supabase เก็บเบอร์เป็นรูปแบบสากล `+66…` เสมอ**

| ที่ไหน | ส่งอะไรได้ |
|---|---|
| `POST /api/auth/register` (backend เรา) | `08…` หรือ `+66…` ก็ได้ — **backend แปลงให้** |
| `supabase.auth.signInWithPassword` | **ต้องเป็น `+66…` เท่านั้น** — Supabase ไม่แปลงให้ |

> ถ้าสมัครด้วย `0812345678` แล้วล็อกอินด้วย `0812345678` **จะล็อกอินไม่ผ่าน**
> เพราะ Supabase เก็บไว้เป็น `+66812345678`

แปลงในแอปทั้งสองหน้าจอ:

```ts
/** 0812345678 → +66812345678 (ตัดเว้นวรรคและขีดออกก่อน) */
export function toE164(input: string): string {
  const digits = input.replace(/[\s-]/g, "");
  return digits.startsWith("0") ? `+66${digits.slice(1)}` : digits;
}
```

ให้ผู้ใช้พิมพ์เบอร์แบบที่ใช้ในชีวิตประจำวัน — **อย่าให้ผู้ป่วยสูงอายุต้องพิมพ์ `+66` เอง**

---

## 4. สมัครสมาชิก

สมัครผ่าน **backend ของเรา** ไม่ใช่ `supabase.auth.signUp` เพราะต้องสร้างโปรไฟล์ในระบบ PDLIFE ไปพร้อมกัน — ถ้าเรียก Supabase ตรงๆ จะได้บัญชีที่ล็อกอินได้แต่ใช้แอปไม่ได้

```ts
const res = await fetch(`${API_URL}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    first_name: "สมชาย",
    last_name: "ใจดี",
    phone_number: "0812345678",   // ส่งแบบไทยได้เลย
    password: "รหัสอย่างน้อย 8 ตัว",
    role: "patient",              // หรือ "caregiver"
    preferred_language: "th",     // ไม่บังคับ
  }),
});
// 201 → { user: {...} }
// 409 → เบอร์นี้สมัครไปแล้ว
// 400 → เบอร์ผิดรูปแบบ หรือรหัสผ่านสั้นเกินไป
```

**ไม่ต้องส่ง `user_name`** — ระบบตั้งให้เท่ากับเบอร์โทรอัตโนมัติ
**ไม่มี SMS ยืนยัน** — สมัครเสร็จล็อกอินได้ทันที

### ข้อจำกัดรหัสผ่าน

- อย่างน้อย 8 ไบต์
- ไม่เกิน 72 ไบต์ — **ภาษาไทย 1 ตัวอักษร = 3 ไบต์** จึงได้ประมาณ 24 ตัวอักษรไทย
  (เพดานนี้เป็นข้อจำกัดของ bcrypt เอง ไม่ใช่กฎที่เราตั้ง — ยาวกว่านี้จะถูกตัดทิ้งเงียบๆ จึงกันไว้ตั้งแต่ต้น)

---

## 5. เข้าสู่ระบบ

```ts
const { data, error } = await supabase.auth.signInWithPassword({
  phone: toE164(phoneInput),   // ต้องแปลงก่อน
  password,
});
if (error) {
  // เบอร์หรือรหัสผ่านไม่ถูกต้อง — อย่าบอกว่าผิดตัวไหน
}
```

SDK เก็บ session และต่ออายุให้เอง **ไม่ต้องเขียน refresh logic**

```ts
await supabase.auth.signOut();                          // ออกจากระบบ
await supabase.auth.updateUser({ password: newPass });  // เปลี่ยนรหัส (ต้องล็อกอินอยู่)
```

**ลืมรหัสผ่าน — ยังไม่เปิดใช้งาน** ตอนนี้ต้องติดต่อเจ้าหน้าที่ อนาคตจะใช้ OTP ทาง SMS (`signInWithOtp` → `updateUser`) ซึ่งเป็นงานฝั่งแอปล้วน ไม่ต้องแก้ backend

---

## 6. เรียก API ของ backend

ทุก request ต้องแนบ token ที่ได้จาก Supabase

```ts
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("ยังไม่ได้เข้าสู่ระบบ");

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (res.status === 401) { /* token ใช้ไม่ได้แล้ว → พาไปหน้าล็อกอิน */ }
  if (res.status === 403) { /* ไม่มีสิทธิ์เข้าถึงข้อมูลนี้ */ }
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}
```

รูปแบบ error เหมือนกันทุก endpoint:

```json
{ "error": "ข้อความอธิบาย", "details": {} }
```

---

## 7. ตรวจ role ก่อนเข้าแอป

บุคลากรใช้ Supabase project เดียวกัน **หมอที่เผลอล็อกอินเข้าแอปผู้ป่วยจะผ่านการยืนยันตัวตนได้**

```ts
const { user } = await api<{ user: { role: string } }>("/api/auth/me");

if (user.role !== "patient" && user.role !== "caregiver") {
  // "บัญชีนี้เป็นของบุคลากรทางการแพทย์ กรุณาใช้งานผ่านเว็บ"
  await supabase.auth.signOut();
}
```

---

## 8. Endpoint ที่แอปใช้ได้

### โปรไฟล์

| Method | Path | ใครใช้ได้ |
|---|---|---|
| `GET` | `/api/auth/me` | ทุกคนที่ล็อกอิน |
| `POST` | `/api/patients/me` | ผู้ป่วย — สร้างโปรไฟล์ครั้งแรก (onboarding) |
| `GET` | `/api/patients/me` | ผู้ป่วย |
| `GET` | `/api/patients/:patientId` | ตัวเอง / ผู้ดูแลที่ผูกไว้ |
| `PATCH` | `/api/patients/:patientId` | ตัวเอง (ผู้ดูแลแก้ไม่ได้) |

### ผู้ดูแล

| Method | Path | ใครใช้ได้ |
|---|---|---|
| `POST` | `/api/patients/:patientId/caregivers` | ผู้ป่วย — ผูกผู้ดูแลเข้ากับตัวเอง |
| `GET` | `/api/patients/:patientId/caregivers` | ผู้ป่วย |
| `PATCH` | `/api/patients/:patientId/caregivers/:linkId` | ผู้ป่วย — แก้สิทธิ์ / ยกเลิก |
| `GET` | `/api/caregivers/me/patients` | **ผู้ดูแล** — ดูผู้ป่วยที่ตัวเองดูแล |

### ยาและการกินยา

| Method | Path | ใครใช้ได้ |
|---|---|---|
| `GET` | `/api/medications` · `/api/medications/:id` | ทุกคนที่ล็อกอิน (อ่านอย่างเดียว) |
| `GET` | `/api/patients/:patientId/prescriptions` | ตัวเอง / ผู้ดูแล |
| `GET` | `/api/patients/:patientId/medication-logs` | ตัวเอง / ผู้ดูแล |
| `PATCH` | `/api/medication-logs/:id/taken` | ผู้ป่วย / ผู้ดูแลที่มีสิทธิ์ตอบ |
| `PATCH` | `/api/medication-logs/:id/skip` | ผู้ป่วย / ผู้ดูแลที่มีสิทธิ์ตอบ |

> `medication_logs` ถูกสร้างโดยระบบเองเมื่อถึงเวลากินยา — **แอปไม่ต้องสร้าง มีแต่ทำเครื่องหมายว่ากินแล้ว/ข้าม**

### บันทึกอาการ (หัวใจของแอป)

| Method | Path | ใครใช้ได้ |
|---|---|---|
| `GET` | `/api/patients/:patientId/rounds` | ตัวเอง / ผู้ดูแล — `?status=pending` ดูที่ยังไม่ตอบ |
| `POST` | `/api/rounds/adhoc` | ผู้ป่วย / ผู้ดูแล — บันทึกอาการนอกรอบ |
| `GET` | `/api/rounds/:id` | ตัวเอง / ผู้ดูแล |
| `GET` | `/api/rounds/:id/questions` | ตัวเอง / ผู้ดูแล |
| `PUT` | `/api/rounds/:id/responses/:questionCode` | ผู้ป่วย / ผู้ดูแลที่มีสิทธิ์ตอบ |

### การแจ้งเตือน

| Method | Path |
|---|---|
| `POST` | `/api/devices` — ลงทะเบียน push token **เรียกทุกครั้งหลังล็อกอิน** |
| `PATCH` | `/api/devices/:id` |

### แอปเรียกไม่ได้ (จะได้ 403)

`/api/patients` (รายชื่อทั้งหมด) · `/api/patients/:id/dashboard/*` · `/api/dashboard/roster` · `/api/patients/:id/red-flags` · `/api/red-flags/*` · `/api/users/app-users` · `/api/auth/provision` · `POST`/`PATCH` `/api/medications` · `POST /api/patients/:id/prescriptions`

---

## 9. Flow หลัก: บันทึกอาการ

```
GET /api/patients/:id/rounds?status=pending
        ↓  ได้รายการที่ยังไม่ตอบ
GET /api/rounds/:roundId/questions
        ↓  { round, questions: [...] }
```

**`questions` คือรายการที่ควรแสดง ณ ตอนนี้เท่านั้น** — server ประเมินเงื่อนไขให้แล้ว **แอปไม่ต้องเขียน logic ซ่อน/แสดงคำถามเอง**

```ts
// ตอบทีละข้อ
await api(`/api/rounds/${roundId}/responses/${questionCode}`, {
  method: "PUT",
  body: JSON.stringify({
    answer_value: { choice: "state_off" },  // ใช้ code จาก options_json
    submitted_at: new Date().toISOString(), // เวลาบนเครื่องผู้ใช้
  }),
});

// ข้ามข้อ
await api(`/api/rounds/${roundId}/responses/${questionCode}`, {
  method: "PUT",
  body: JSON.stringify({ skipped: true }),
});
```

**หลังตอบแต่ละข้อให้เรียก `/questions` ใหม่** เพราะคำตอบอาจปลดล็อกคำถามข้อถัดไป

### โครงสร้างคำถาม

```ts
{
  question_code: string;
  sort_order: number;
  required: boolean;
  answered: boolean;
  question: {
    question_full_th: string;   // ข้อความที่แสดงให้ผู้ป่วยอ่าน
    answer_type: string;        // single_choice | boolean | ordinal_scale_0_4 | text …
    options_json: [{ code?: string; value?: string; label: string; score: number | null }];
    ui_input_hint: string | null;
  };
}
```

- ปุ่มตัวเลือกแสดงด้วย `label` · ส่งกลับด้วย `code` (ถ้าไม่มี `code` ให้ใช้ `value`)
- **ห้ามส่ง `score`** — server คำนวณเองเสมอจากคลังคำถาม ส่งไปก็ถูกละทิ้ง

---

## 10. ทำงานตอนออฟไลน์

`submitted_at` = เวลาบนเครื่องผู้ใช้ · `received_at` = เวลาที่ server ได้รับ

**เก็บคำตอบไว้ในเครื่องพร้อม `submitted_at` แล้วส่งตอนมีเน็ต** — server บันทึกทั้งสองเวลา ทำให้หมอเห็นว่าผู้ป่วยตอบตอนไหนจริงๆ ไม่ใช่ตอนที่เน็ตกลับมา ซึ่งสำคัญมากกับข้อมูลอาการที่ผูกกับเวลากินยา

---

## 11. เรื่องที่พลาดกันบ่อย

| ปัญหา | สาเหตุ |
|---|---|
| ล็อกอินไม่ผ่านทั้งที่รหัสถูก | ส่งเบอร์เป็น `08…` แทน `+66…` |
| ได้ 401 ทุก request | ไม่ได้แนบ `Authorization: Bearer …` หรือแนบ publishable key แทน access token |
| ได้ 403 ตอนดูข้อมูลผู้ป่วย | ผู้ดูแลยังไม่ถูกผูกกับผู้ป่วยคนนั้น |
| ผู้ดูแลตอบคำถามแทนไม่ได้ | ตอนผูกไม่ได้ตั้ง `can_answer: true` |
| คำถามข้อถัดไปไม่โผล่ | ไม่ได้เรียก `/questions` ใหม่หลังตอบ |
| เวลาเพี้ยน 7 ชั่วโมง | เวลาที่ API คืนเป็น UTC — ต้องแปลงเป็นเวลาไทยตอนแสดงผล |

---

## 12. สิ่งที่ยังไม่มีใน backend

อย่าออกแบบหน้าจอรอบสิ่งเหล่านี้จนกว่าจะมีประกาศ

- ตารางนัดหมาย (สร้าง / แก้ไข)
- ลืมรหัสผ่านด้วยตัวเอง
- ผู้ป่วยดู dashboard ของตัวเอง (เอกสารความต้องการระบุว่าเป็นเฟส 2)
- การบันทึกความยินยอม PDPA

---

## เอกสารที่เกี่ยวข้อง

- `API_CONTRACT.md` — รายละเอียด request / response ครบทุก endpoint
- `API_EXAMPLES.md` — ตัวอย่างการเรียก
