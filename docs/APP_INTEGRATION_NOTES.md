# บันทึกถึงทีมแอป — ผลตรวจ pdlife-app เทียบกับ backend

**วันที่ตรวจ:** 8 ก.ย. 2569 · **ตรวจจาก:** snapshot ของ `pdlife-app` ที่ส่งมา (ไม่ใช่ git repo จึงไม่มี
commit อ้างอิง) · **ผู้ตรวจ:** ทีม backend/web

เอกสารนี้อ่านคู่กับ `API_CONTRACT.md` (สัญญาฉบับจริง — ถ้าขัดกันให้ยึดฉบับนั้น)

> **ภาพรวม: สถานะดีกว่าที่คาดมาก** endpoint 18 ตัวที่แอปเรียกจริงตรงกับ contract ครบทุกตัว ทั้ง path,
> method และชื่อฟิลด์ marker `TODO(backend)` ที่ทีมเขียนไว้ ~39 จุดก็อ่านง่ายและตรงประเด็น
> ทำให้ตรวจรอบนี้เร็วกว่าที่ควรจะเป็นมาก ขอบคุณครับ

---

## 0. 🛑 ตัวบล็อกใหญ่สุด: ล็อกอินจะไม่มีวันสำเร็จ — และเป็นความผิดเอกสารเรา

**อาการที่จะเจอ:** ผู้ใช้สมัครผ่านแอปสำเร็จ (201) แล้วล็อกอินไม่ได้ ขึ้น
`401 Invalid username or password` ทุกครั้งตลอดไป ทั้งที่รหัสผ่านถูก

**สาเหตุ:** แอปใช้คู่ `POST /auth/register` → `POST /auth/login` ซึ่งเป็นสองระบบคนละตัว

- `POST /auth/register` (ที่แอปใช้) สร้างบัญชีไว้ใน **Supabase Auth** และตั้ง
  `users.password_hash` เป็น **NULL** โดยตั้งใจ (รหัสผ่านไม่ได้เก็บฝั่งเราแล้ว)
- `POST /auth/login` ตรวจ `password_hash` — `authService.ts:181` เขียนว่า
  `if (!user || !user.password_hash) throw 401` → บัญชีที่สมัครผ่านแอปเข้าเงื่อนไขนี้ทุกบัญชี

**เรื่องนี้เราขอโทษครับ — `API_CONTRACT.md` เขียน `POST /auth/login` ว่า "public" เฉยๆ ไม่มีคำเตือน**
ทีมอ่านแล้วสร้างตามนั้นถูกต้องทุกอย่าง (คอมเมนต์ใน `src/api/auth.ts` อ้างไฟล์/บรรทัดของเราแม่นมาก)
ตอนนี้แก้สัญญาให้ชัดแล้วว่าเส้นทางนี้เหลือไว้เฉพาะบุคลากรที่ไม่มีอีเมล และจะถูกลบในเฟส 3

**ทางแก้:** ผู้ป่วย/ผู้ดูแลต้องล็อกอินกับ **Supabase Auth โดยตรง** ด้วยเบอร์โทร + รหัสผ่าน แล้วเอา
`access_token` ที่ได้มาแนบเป็น bearer เหมือนเดิม — `POST /auth/register` ยังใช้เหมือนเดิม เปลี่ยน
เฉพาะขั้นตอนล็อกอิน · วิธีตั้งค่า client มีอยู่แล้วใน **`docs/MOBILE_INTEGRATION.md` §1–2** (ต้องเพิ่ม
`@supabase/supabase-js` ซึ่งตอนนี้ยังไม่มีใน `package.json`)

ผลพลอยได้: โค้ดกู้คืน 3 ขั้นใน `RegisterScreen.tsx` (register → login → `POST /patients/me` ด้วย
`tokenOverride`) จะง่ายลงมาก และ TODO เรื่อง "login ด้วยเลขบัตร/HN" ใน `src/api/auth.ts` ก็เปลี่ยน
โจทย์ไป เพราะ Supabase ใช้เบอร์โทรเป็นตัวระบุตัวตน

---

## 1. ต้องแก้ฝั่งแอปก่อนต่อของจริง

เรียงตามความรุนแรง — ข้อ 1.1 ทำให้ใช้งานไม่ได้เลย

### 1.1 ตัวเลือกคำตอบจะแสดงเป็นช่องว่างทุกข้อ ⛔

แอปอ่าน `opt.label_th` แต่ **backend ส่งมาเป็น `label`** ตรวจจาก seed จริงแล้วทุกแถวเก็บเป็น
`{code, label, score}` เช่น

```json
[{"code": "state_off", "label": "OFF (ยาไม่ออกฤทธิ์ อาการพาร์กินสันเด่น)", "score": null}]
```

จุดที่ต้องแก้: `QuestionRenderer.tsx`, `SingleChoice.tsx`, `MultiChoice.tsx`, `LikertStepper.tsx`
และ type `QuestionOption` ใน `src/types/api.ts`

> เราคุยกันแล้วว่าจะไม่เปลี่ยนชื่อฟิลด์ฝั่ง DB เป็น `label_th` เพราะ `label` ตรงกับ contract ที่
> ประกาศไว้ตั้งแต่ต้นและมี client อื่น (เว็บ staff) ใช้อยู่ — เปลี่ยนเพื่อ client ตัวเดียวจะกลายเป็นหนี้
> ที่ต้องอธิบายตลอดไปว่าทำไมฟิลด์นี้ชื่อไม่เหมือนฟิลด์อื่น

### 1.2 `respondent` — ค่าที่ DB ส่งจริงคือ `'both'`

`src/types/api.ts` ประกาศ `'patient_or_caregiver' | 'caregiver_preferred' | 'patient_only'` แต่ค่า
จริงในฐานข้อมูลคือ `patient_only | caregiver_preferred | **both**` (ใช้ `'both'` อยู่ 45 แถว)

ตอนนี้ยังไม่พังเพราะ `canRespond()` fallback เป็น `true` แต่ type ไม่ตรงกับความจริง — วันที่มีคนเขียน
`switch` ครบทุก case จะเจอปัญหาทันที

### 1.3 รอบ POST_MED_MICRO ถามไม่ครบ

`templateQuestions.mock.ts` ผูกไว้ข้อเดียว (`MED_ONOFF_NOW`) แต่ seed จริงมี 3 ข้อ — ขาด
`MED_ADHERENCE` และ `MED_DYSKINESIA_NOW` (ตัวหลังเป็นตัวป้อน dyskinesia_rate ในหน้าสถิติของหมอ)

### 1.4 คลังคำถามใน mock เป็นฉบับร่าง

`questionBank.mock.ts` เขียนไว้เองที่บรรทัดแรกว่า *"⚠️ DRAFT PLACEHOLDER — ยังไม่ใช่เนื้อหาจริง"*
(49 ข้อ) ส่วน seed จริงมี **45 ข้อ** — ดึงของจริงได้จาก `GET /question-bank` เลย ไม่ต้อง mock แล้ว

### 1.5 เกณฑ์กินยาตรงเวลาไม่ตรงกับฝั่งเรา

| | ค่าที่ใช้ |
|---|---|
| แอป (`CaregiverPatientDetailScreen.tsx`, `MedicationsHomeScreen.tsx`) | `>= 0.80` และแถบ 90/70/50 |
| backend + เว็บ staff | **`0.70`** |

ผลคือผู้ป่วยคนเดียวกันจะถูกจัดว่า "ไม่ผ่านเกณฑ์" ในแอปแต่ "ปกติ" ในหน้าหมอ — ค่าที่ถูกต้องคือ **0.70**
(ฝั่งเรามีเทสผูกไว้ไม่ให้ backend กับเว็บเพี้ยนจากกัน: `tests/thresholdSync.test.ts`)

ค่าคลินิกกลางชุดปัจจุบัน — แนะนำให้รวมไว้ที่ `src/constants/clinical.ts` ไฟล์เดียวแทนที่จะกระจาย
อยู่ในไฟล์หน้าจอ:

| ค่า | ที่ถูกต้อง |
|---|---|
| กินยาตรงเวลาขั้นต่ำ | `0.70` |
| สัดส่วน OFF ที่ถือว่าต้องเฝ้าระวัง | `0.40` |
| OFF ติดกันกี่วันถึงเตือน | `3` |
| กินสายเกินกี่นาที | `30` |
| ช่วงสรุปอาการ | `7` วัน |
| ช่วงดูสัญญาณเตือน | `30` วัน |
| MOOD-04 gate | score `>= 2` (ตรงกันอยู่แล้ว ✅) |

### 1.6 ตรวจเลขบัตรประชาชนยังไม่มี checksum

`utils/identifier.ts` เช็คแค่ความยาว 13 หลัก — เลขที่พิมพ์ผิดหนึ่งตัวจะผ่านหมด ฝั่งเว็บมี
`isValidThaiId()` (ตรวจ checksum หลักที่ 13) และ `thaiIdCard()` (จัดรูป `3-1015-02347-12-3`) อยู่ใน
`pdlife-web/lib/pdlife/format.ts` เป็น TypeScript ล้วนไม่มี dependency — คัดลอกไปใช้ได้เลย
เช่นเดียวกับ `thaiPhone()`, `percent()`, `daysAgoLabel()`

---

## 2. ของที่มีอยู่แล้ว เลิก mock ได้ทันที

ส่วนนี้น่าจะลดงานได้มากที่สุด — คอมเมนต์ในแอปหลายจุดเขียนว่า "ยังไม่มี endpoint" ทั้งที่มีแล้ว

| แอป mock ไว้ที่ | ใช้ของจริงได้เลย |
|---|---|
| `prescriptions.ts` | `GET /patients/:patientId/prescriptions` |
| `medicationLogs.ts::getTodayMedicationLogsMock` | `GET /patients/:patientId/medication-logs` |
| `rounds.mock.ts` ("GET /rounds/today") | `GET /patients/:patientId/rounds?status=pending` |
| `appointments.mock.ts` (จองนัด) | `POST /patients/:patientId/appointments` |
| ช่องเลือกเวลานัด | `GET /appointments/available-slots?doctor_id=&date=` |
| `questionBank.mock.ts` | `GET /question-bank` |
| แคตตาล็อกยา | `GET /medications` |

### เรื่อง join ที่ขอมา (ชื่อยาใน medication-logs, `medication` object ในใบสั่งยา)

**ขอไม่ทำให้ครับ** — ให้เรียก `GET /medications` ครั้งเดียวตอนเปิดแอปแล้ว join ฝั่ง client
แคตตาล็อกยาเล็ก เปลี่ยนน้อยมาก และแคชได้ทั้งวัน ถ้าเราฝัง join ไว้ในหลาย endpoint จะกลายเป็น
โค้ดที่ต้องแก้พร้อมกันทุกครั้งที่เพิ่มฟิลด์ยา และทำให้ response ของทุกหน้าจอใหญ่ขึ้นทั้งที่ส่วนใหญ่
ไม่ได้ใช้

ส่วน `medication.image_url` และ `medication.indication` **ไม่มีในฐานข้อมูล** ยังไม่มีแผนเพิ่ม

---

## 3. ของใหม่ที่เพิ่งเพิ่มให้ (พร้อมใช้แล้ว)

ทั้งหมดเป็นการเพิ่ม ไม่กระทบ endpoint เดิม · รายละเอียดเต็มอยู่ใน `API_CONTRACT.md`

### 3.1 `GET /notifications` + `PATCH /notifications/:id/read`

ปิด TODO ใน `src/types/notifications.ts` และ `src/api/notifications.ts` — เดิม scheduler เขียน
แถวแจ้งเตือนทุกวันแต่ไม่มีทางอ่านกลับ

```
GET /api/notifications?unread_only=true&limit=50
→ { notifications: [{ id, type, patient_id, appointment_id, medication_log_id,
                      triggered_at, delivery_status, is_read, ... }] }
PATCH /api/notifications/:id/read → { notification }
```

**สิ่งที่ควรรู้:** ตารางนี้เป็น delivery log — เขียน 1 แถวต่อ 1 อุปกรณ์ที่ยิงไป ผู้ใช้ที่มีสองเครื่องจะมี
หลายแถวของเรื่องเดียวกัน endpoint นี้**ยุบให้เหลือรายการเดียวต่อเหตุการณ์แล้ว** และถือว่าอ่านแล้วถ้า
กดอ่านจากเครื่องใดเครื่องหนึ่ง — ฝั่งแอปไม่ต้อง dedupe เอง แต่แปลว่าจำนวนที่ได้อาจน้อยกว่า `limit`
(ไม่ใช่ cursor)

### 3.2 `GET /patients/:patientId/appointments`

ปิด TODO ใน `appointments.mock.ts` ทั้ง 3 จุด — ตัวเดียวครอบทั้ง 3 หน้าจอ

```
GET /api/patients/:id/appointments              → ทุกนัด เรียงล่าสุดก่อน (หน้ารายการ/ประวัติ)
GET /api/patients/:id/appointments?from=2026-09-08&limit=3
                                                → ตั้งแต่วันนั้นไป เรียงใกล้สุดก่อน (การ์ดหน้าแรก)
```

รูปแถวเหมือน `GET /appointments` ของฝั่ง staff เป๊ะ (มี `patient_name`, `doctor_name`,
`visit_date`, `visit_time`, `visit_type`, `status`, `screening`, `doctor_note_at`)

> `Appointment` type ในแอปมีฟิลด์ที่ **ไม่มีในฐานข้อมูล**: `location`, `building`,
> `treatment_right`, `reason`, `note`, `created_by`, `created_appoint_name` และแอปใช้ `doctor_id`
> แต่ API คืน `doctor_name` (ไม่คืน id) — ต้องปรับ type ตาม

### 3.3 `GET /users/lookup?phone=`

ปิด TODO ใน `patientCaregivers.ts::findCaregiverByPhone` ที่ตอนนี้โยน 501 อยู่ (บล็อกหน้า
`AddCaregiverScreen` กับ `CaregiverAccountScreen`)

```
GET /api/users/lookup?phone=081-234-5678
→ { caregiver: { id, first_name, last_name, role: "caregiver" } }
404 = ไม่มีบัญชีผู้ดูแลที่ใช้เบอร์นี้
```

รับเบอร์แบบที่ผู้ใช้พิมพ์ (มีขีด/เว้นวรรคได้) แปลงเป็น `+66…` ให้เอง · คืนเฉพาะบัญชี
`role=caregiver` ที่ยัง active · **มี rate limit 20 ครั้ง/15 นาทีต่อบัญชี** เพราะเป็นการค้นเบอร์→ตัวตน
กรุณาอย่าเรียกใน `useEffect` ที่ยิงทุก keystroke — ให้ยิงตอนกดปุ่มค้นหา

### 3.4 `single_choice_with_text` เก็บข้อความแล้ว

เดิม backend ตัดทิ้งเงียบๆ เหลือแค่ `{choice, score}` — ตอนนี้ส่ง `answer_value.text` มาได้

```json
PUT /api/rounds/:id/responses/MOOD_IMPULSE_CONTROL
{ "answer_value": { "choice": "yes", "text": "เล่นการพนันออนไลน์ทุกคืน" } }
```

มีข้อเดียวที่ใช้คือ **MOOD-03 (การควบคุมแรงกระตุ้น)** ซึ่งตัวเลือก "มี" เขียนกำกับว่า
*"(ระบุว่าเป็นเรื่องอะไร)"* — ข้อความตรงนี้คือสาระทางคลินิกทั้งหมด เพราะการพนัน กินผิดปกติ และ
เรื่องเพศ เป็นคนละเรื่องกันในแง่การดูแล ไม่บังคับกรอก (ผู้ป่วยมีสิทธิ์ตอบว่ามีแล้วไม่เล่าต่อ)

---

## 4. ยังไม่มี และยังไม่มีแผนทำรอบนี้

ให้ mock ต่อไปก่อนได้ แต่ควรรู้ว่าไม่ได้อยู่ในคิวอันใกล้ เผื่อวางแผนฝั่งแอป:

| เรื่อง | สถานะ |
|---|---|
| consent / PDPA (`consentStore.ts`) | ต้องออกแบบตารางใหม่ — เป็นงานแยกที่ต้องวางแผนเอง |
| แพ้ยา (`allergiesMock.ts`) | ไม่มีตาราง ผู้ป่วยแพ้ได้หลายรายการจึงต้องเป็นตารางแยก |
| สถิติ/แดชบอร์ดฝั่งผู้ป่วย (`HomeSelfSummary`, `StatisticsSummary`) | เอกสาร requirement ระบุเป็น phase 2 |
| ลืมรหัสผ่าน (`ForgotPasswordScreen`) | ยังไม่มี endpoint |
| บันทึก `preferred_language` | ยังไม่มี endpoint |
| `POST /auth/register` คืน token | ยังไม่ทำ และ**จะไม่ทำ** — หลังย้ายไป Supabase Auth (ข้อ 0) token มาจาก Supabase ไม่ใช่จากเรา |

### กราฟ motor state ที่ใช้แกน −3..+3

`src/types/statistics.ts` เขียนไว้เองแล้วว่าแกนคะแนนต่อเนื่องนี้ **ไม่มีอยู่จริงในข้อมูล** —
`MED_ONOFF_NOW` เป็น `single_choice` (`state_on` / `state_off` / `too_soon` / `asleep`) และ mock
เป็นคนสร้างสัญญาณต่อเนื่องขึ้นมาเอง

ฝั่งเว็บเจอโจทย์เดียวกันและเลือกวาดเป็น**จุดรายช่วงเวลา ไม่ลากเส้นเชื่อม** โดยตั้งใจ เพราะเราไม่รู้ว่า
ระหว่างสองจุดที่ผู้ป่วยตอบ อาการเป็นอย่างไร (ดู `pdlife-web/components/pdlife/onoff-timeline.tsx`)
ถ้าจะทำให้ตรงกัน แนะนำให้ปรับมาทางนี้ — เส้นต่อเนื่องที่ดูน่าเชื่อถือกว่าความจริงเป็นปัญหาเวลาหมอ
ใช้ตัดสินใจปรับยา

---

## 5. เรื่องอื่นที่สังเกตเห็น

- **`node_modules` ยังไม่เคยติดตั้งใน snapshot ที่ส่งมา** — และ `EXPO_PUBLIC_API_BASE_URL` (env
  ตัวเดียวที่แอปใช้) มี default เป็น `http://localhost:3000` อยู่แล้ว ซึ่งตรงกับพอร์ตที่ backend รัน
  ถ้าจะลองต่อของจริงน่าจะแค่ `npm install` แล้วรัน backend คู่กันได้เลย
- **`README.md` ล้าสมัย** — เขียนว่ายังไม่มี `src/api/`, flowEngine, offline queue แต่ของจริงมีครบแล้ว
- **offline queue ไม่มี idempotency key** (`writeQueue.ts`) — ถ้าแอปถูกปิดระหว่าง `POST /rounds/adhoc`
  สำเร็จแต่ยังไม่ทันบันทึก `roundId` ลง storage จะเกิดรอบซ้ำที่ไม่มีใครล้าง ถ้าเจอปัญหานี้จริงบอกได้
  เรายินดีเพิ่ม `client_ref` ให้
- **`evaluateCondition` ของแอปกับ backend ต่างกัน 2 จุด** — operator ที่ไม่รู้จัก แอปคืน `true`
  แต่ backend คืน `false` (แอปจะโชว์คำถามที่ควรซ่อน) และการเทียบ `==` แอป coerce ชนิดข้อมูล
  แต่ backend เทียบแบบ strict · `src/api/rounds.ts` เขียนไว้เองแล้วว่า client ไม่ควรรัน flow engine
  ซ้ำกับ API จริง ซึ่งถูกต้อง — แต่ถ้ายังใช้ตอน offline อยู่ ควรทำให้ตรงกัน
