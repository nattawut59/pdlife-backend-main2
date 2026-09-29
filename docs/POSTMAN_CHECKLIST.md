# Postman Checklist

เช็คลิสต์ว่า endpoint ไหนถูกใส่เข้า collection "PD Life API" แล้วบ้าง ตอนนี้ collection มีแค่
`Health Check`, `Register`, `New Request` — ไฟล์นี้คือโครงสร้าง folder/request ที่ควรมีให้ครบ
ตาม route จริงใน `src/routes/`

รายละเอียด request/response body ของแต่ละ endpoint **ดูที่ `API_CONTRACT.md`** (ลิงก์หัวข้อกำกับ
ไว้ในแต่ละแถว) ไฟล์นี้เป็นแค่ตัวเช็คว่าใส่ครบหรือยัง ไม่ก๊อปปี้ body มาซ้ำ

Base URL: `{{base_url}}` (env var) → `http://localhost:3000` ตอน dev, prefix `/api` ทุกตัวยกเว้น
`/health`

## วิธีใช้

ตั้ง Postman collection variable `base_url` และ `token` (จาก `POST /auth/login` หรือ `/auth/register`)
ไว้ที่ collection level แล้วให้ทุก request ที่ต้อง auth ใช้ `Authorization: Bearer {{token}}`

---

## 0. Health

- [x] `GET {{base_url}}/health` — ไม่ต้อง auth

## 1. Auth (`/api/auth`) — public บางตัว

- [x] `POST /auth/register` — public, rate-limited → §Auth `POST /auth/register`
- [ ] `POST /auth/provision` — role: admin → §Auth `POST /auth/provision`
- [ ] `POST /auth/login` → §Auth `POST /auth/login`
- [ ] `GET /auth/me` — auth ใดก็ได้ → §Auth `GET /auth/me`

## 2. Patients (`/api/patients`) — ทุกตัวต้อง auth

- [ ] `POST /patients/me` — role: patient
- [ ] `GET /patients/me` — role: patient
- [ ] `GET /patients` — role: nurse/doctor/admin
- [ ] `POST /patients/:userId` — role: nurse/doctor/admin
- [ ] `GET /patients/:userId` — self / linked caregiver / staff
- [ ] `PATCH /patients/:userId` — self / staff
- [ ] `POST /patients/:patientId/caregivers`
- [ ] `GET /patients/:patientId/caregivers`
- [ ] `PATCH /patients/:patientId/caregivers/:linkId`
- [ ] `POST /patients/:patientId/appointments` — role: patient/caregiver (self-booking)
- [ ] `GET /patients/:patientId/appointments`
- [ ] `POST /patients/:patientId/prescriptions` — role: doctor/nurse/admin
- [ ] `GET /patients/:patientId/prescriptions`
- [ ] `GET /patients/:patientId/medication-logs`
- [ ] `POST /patients/:patientId/event-logs` — role: patient/caregiver
- [ ] `GET /patients/:patientId/event-logs`
- [ ] `GET /patients/:patientId/rounds`
- [ ] `GET /patients/:patientId/dashboard/timeline` — staff only
- [ ] `GET /patients/:patientId/dashboard/summary` — staff only
- [ ] `GET /patients/:patientId/dashboard/warnings` — staff only
- [ ] `GET /patients/:patientId/dashboard/app-answers` — staff only
- [ ] `GET /patients/:patientId/red-flags` — staff only
- [ ] `GET /patients/:patientId/dashboard/visit-comparison/:appointmentId` — staff only

## 3. Caregivers (`/api/caregivers`)

- [ ] `GET /caregivers/me/patients` — role: caregiver

## 4. Appointments (`/api/appointments`) — ทุกตัวต้อง auth

- [ ] `GET /appointments` — role: nurse/doctor/admin
- [ ] `POST /appointments` — role: nurse/doctor/admin (walk-in/staff-booked)
- [ ] `GET /appointments/available-slots` — auth ใดก็ได้
- [ ] `GET /appointments/counts` — role: nurse/doctor/admin
- [ ] `PATCH /appointments/:appointmentId/status` — role: nurse/doctor/admin
- [ ] `GET /appointments/:appointmentId/assessment` — role: nurse/doctor/admin
- [ ] `PUT /appointments/:appointmentId/assessment` — role: nurse/doctor/admin
- [ ] `PATCH /appointments/:appointmentId/assessment/opened` — role: nurse/doctor/admin
- [ ] `GET /appointments/:appointmentId/note` — role: nurse/doctor/admin
- [ ] `PUT /appointments/:appointmentId/note` — role: doctor/admin

## 5. Medications catalog (`/api/medications`)

- [ ] `GET /medications`
- [ ] `GET /medications/:id`
- [ ] `POST /medications` — role: admin
- [ ] `PATCH /medications/:id` — role: admin

## 6. Prescriptions (`/api/prescriptions`)

- [ ] `PATCH /prescriptions/:id` — role: doctor/nurse/admin

## 7. Medication logs (`/api/medication-logs`)

- [ ] `PATCH /medication-logs/:id/taken`
- [ ] `PATCH /medication-logs/:id/skip`

## 8. Rounds & responses (`/api/rounds`)

- [ ] `POST /rounds/adhoc`
- [ ] `GET /rounds/:id`
- [ ] `GET /rounds/:id/questions`
- [ ] `PUT /rounds/:id/responses/:questionCode`

## 9. Devices — push notifications (`/api/devices`)

- [ ] `POST /devices`
- [ ] `PATCH /devices/:id`

## 10. Notifications (`/api/notifications`)

- [ ] `GET /notifications`
- [ ] `PATCH /notifications/:id/read`

## 11. Dashboard — clinic-wide (`/api/dashboard`)

- [ ] `GET /dashboard/roster` — role: nurse/doctor/admin

## 12. Red flags (`/api/red-flags`)

- [ ] `PATCH /red-flags/:flagId/review` — role: nurse/doctor/admin

## 13. Users / app-users (`/api/users`)

- [ ] `GET /users/app-users` — role: nurse/doctor/admin
- [ ] `GET /users/staff` — auth ใดก็ได้
- [ ] `GET /users/lookup?phone=` — rate-limited

## 14. Audit log (`/api/audit-logs`)

- [ ] `GET /audit-logs` — role: admin

## 15. Question bank (`/api/question-bank`)

- [ ] `GET /question-bank` — auth ใดก็ได้

---

## สรุปจำนวน

15 folder, 55 request (รวม health) — ตอนนี้ทำแล้ว 2/55 (`register`, `health` — ปรับ checkbox
ด้านบนเองเวลาทำเพิ่ม)

ตัวที่ควรทำก่อนเพราะ endpoint อื่นเกือบทั้งหมดต้องมี token: `POST /auth/login` — ตัวเดียวที่คืน
`token` มาด้วย (`/auth/register` คืนแค่ `{ user }` ไม่มี token ต้อง login ต่ออีกที) → เซฟ token
ใส่ collection variable ด้วย Postman test script:

```js
pm.collectionVariables.set("token", pm.response.json().token);
```
