# PDLIFE Backend — Example API Usage

Base URL: `http://localhost:3000/api`. All endpoints except `/auth/register` and `/auth/login`
require `Authorization: Bearer <token>`.

## 1. Auth

### Register (patient self-signup)

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "สมชาย",
    "last_name": "ใจดี",
    "user_name": "somchai01",
    "password": "S3curePass!",
    "role": "patient",
    "phone_number": "0812345678"
  }'
```

```json
{ "user": { "id": "…", "user_name": "somchai01", "role": "patient", "is_active": true, "…": "…" } }
```

`role` is restricted to `patient | caregiver` here — staff accounts (`nurse`/`doctor`/`admin`)
must go through `/auth/provision` (admin-only).

### Register (caregiver self-signup)

`role: "caregiver"` requires the extra profile fields below (400 if any are missing).
`relationship` here is a default filled in at signup — separate from the `relationship` set
per-patient when linking via `POST /patients/:patientId/caregivers`, since one caregiver can
look after multiple patients with a different relationship to each.

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "สมหญิง",
    "last_name": "รักดี",
    "password": "S3curePass!",
    "role": "caregiver",
    "phone_number": "0898765432",
    "prefix": "นาง",
    "gender": "female",
    "date_of_birth": "1975-05-20",
    "relationship": "ลูกสาว",
    "address_line": "99/1 ถนนสุขุมวิท",
    "subdistrict": "คลองตัน",
    "district": "วัฒนา",
    "province": "กรุงเทพมหานคร",
    "postal_code": "10110"
  }'
```

```json
{ "user": { "id": "…", "user_name": "+66898765432", "role": "caregiver", "is_active": true, "…": "…" } }
```

### Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "user_name": "somchai01", "password": "S3curePass!" }'
```

```json
{ "token": "eyJhbGciOi...", "user": { "id": "…", "role": "patient", "…": "…" } }
```

### Provision a staff account (admin only)

```bash
curl -X POST http://localhost:3000/api/auth/provision \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "first_name": "หมอ", "last_name": "ดี", "user_name": "dr_dee",
    "password": "S3curePass!", "role": "doctor"
  }'
```

> Bootstrapping the very first admin: since `/auth/provision` itself requires an existing
> admin, the first one must be inserted directly (see `seed/` once built) rather than via API.

---

## 2. Patient onboarding + caregiver mode

### Patient completes their own profile

```bash
curl -X POST http://localhost:3000/api/patients/me \
  -H "Authorization: Bearer $PATIENT_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "date_of_birth": "1958-03-12",
    "wake_time": "07:00",
    "sleep_time": "22:30",
    "diagnosis": "PD",
    "hoehn_yahr_stage": 2
  }'
```

### Link a caregiver (patient or staff can do this)

```bash
curl -X POST http://localhost:3000/api/patients/$PATIENT_ID/caregivers \
  -H "Authorization: Bearer $PATIENT_TOKEN" -H "Content-Type: application/json" \
  -d '{ "caregiver_id": "'"$CAREGIVER_USER_ID"'", "relationship": "บุตร", "is_primary": true }'
```

Caregivers only see patients they're actively linked to, and can only *answer* diary questions
if `can_answer: true` on the link (§`assertCanAccessPatient` in `patientAccessService.ts`).

### Register a device for push notifications

```bash
curl -X POST http://localhost:3000/api/devices \
  -H "Authorization: Bearer $PATIENT_TOKEN" -H "Content-Type: application/json" \
  -d '{ "expo_push_token": "ExponentPushToken[xxxxxxxxxxxx]", "platform": "ios" }'
```

---

## 3. Medication

### Doctor/nurse prescribes a medication

```bash
curl -X POST http://localhost:3000/api/patients/$PATIENT_ID/prescriptions \
  -H "Authorization: Bearer $DOCTOR_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "medication_id": "MED-001",
    "scheduled_times": ["07:00", "12:00", "18:00", "22:00"],
    "doses": { "07:00": "1 เม็ด", "12:00": "1 เม็ด", "18:00": "1 เม็ด", "22:00": "0.5 เม็ด" },
    "start_date": "2026-07-24"
  }'
```

### Patient/caregiver marks a dose taken

The scheduler creates `medication_logs` rows automatically at each `scheduled_times` entry —
the client polls or gets pushed a `medication_reminder`, then confirms:

```bash
curl -X PATCH http://localhost:3000/api/medication-logs/$LOG_ID/taken \
  -H "Authorization: Bearer $PATIENT_TOKEN" -H "Content-Type: application/json" \
  -d '{ "dose_taken": "1 เม็ด" }'
```

This is what causes `POST_MED_MICRO` to fire 30–60 minutes later (§9.1/§9.6).

---

## 4. Diary rounds — the core EMA flow

### Get the questions currently visible in a round

```bash
curl http://localhost:3000/api/rounds/$ROUND_ID/questions \
  -H "Authorization: Bearer $PATIENT_TOKEN"
```

```json
{
  "round": { "id": "…", "template_code": "EVENING_DAILY_CORE", "status": "pending", "…": "…" },
  "questions": [
    { "question_code": "MOOD_DEPRESSED_ANHEDONIA", "required": true, "answered": false, "question": { "…": "…" } }
  ]
}
```

`MOOD_SUICIDAL_IDEATION` only appears here once `MOOD_DEPRESSED_ANHEDONIA` has been answered
with `score >= 2` — the flow engine evaluates `condition_json` server-side, so the client
doesn't need to reimplement that logic.

### Submit an answer

```bash
curl -X PUT "http://localhost:3000/api/rounds/$ROUND_ID/responses/MOOD_DEPRESSED_ANHEDONIA" \
  -H "Authorization: Bearer $PATIENT_TOKEN" -H "Content-Type: application/json" \
  -d '{ "answer_value": { "choice": "2" } }'
```

`score` in the stored response is always re-derived server-side from `question_bank.options_json`
— a client can't spoof it by sending a fabricated `score`.

### Skip a question

```bash
curl -X PUT "http://localhost:3000/api/rounds/$ROUND_ID/responses/MOOD_APATHY" \
  -H "Authorization: Bearer $PATIENT_TOKEN" -H "Content-Type: application/json" \
  -d '{ "skipped": true }'
```

### The MOOD-04 safety path

If `MOOD_SUICIDAL_IDEATION` becomes visible and is answered with anything other than `"none"`
(including `no_answer`, or being skipped), the backend writes a `red_flags` row with
`severity: "urgent"` and `clinic_tag: "suicidal_ideation"` — same request, no extra client call:

```bash
curl -X PUT "http://localhost:3000/api/rounds/$ROUND_ID/responses/MOOD_SUICIDAL_IDEATION" \
  -H "Authorization: Bearer $PATIENT_TOKEN" -H "Content-Type: application/json" \
  -d '{ "answer_value": { "choice": "sometimes" } }'
```

The in-app crisis resource (1323 hotline) must still be shown client-side immediately and
offline — it does not depend on this request succeeding.

### Create an ad-hoc round (patient/caregiver initiated, FR: "ผู้ป่วยกดเอง")

```bash
curl -X POST http://localhost:3000/api/rounds/adhoc \
  -H "Authorization: Bearer $PATIENT_TOKEN" -H "Content-Type: application/json" \
  -d '{ "patient_id": "'"$PATIENT_ID"'" }'
```

---

## 5. Clinic dashboard (C1/C2/C3 — nurse/doctor/admin only)

### C2 — ON/OFF/dyskinesia timeline for the graph

```bash
curl "http://localhost:3000/api/patients/$PATIENT_ID/dashboard/timeline?days=7" \
  -H "Authorization: Bearer $DOCTOR_TOKEN"
```

### C1 — 7-day pre-visit summary

```bash
curl "http://localhost:3000/api/patients/$PATIENT_ID/dashboard/summary?days=7" \
  -H "Authorization: Bearer $DOCTOR_TOKEN"
```

```json
{
  "summary": {
    "window": { "from": "2026-07-17T…", "to": "2026-07-24T…" },
    "off_rate": 0.35,
    "dyskinesia_rate": 0.1,
    "adherence_rate": 0.92,
    "timeline_point_count": 40
  }
}
```

### C3 — this visit vs. the previous one

```bash
curl "http://localhost:3000/api/patients/$PATIENT_ID/dashboard/visit-comparison/$APPOINTMENT_ID" \
  -H "Authorization: Bearer $DOCTOR_TOKEN"
```

### §9.5 warning flags (query-only — never written to `red_flags`)

```bash
curl "http://localhost:3000/api/patients/$PATIENT_ID/dashboard/warnings?days=7" \
  -H "Authorization: Bearer $DOCTOR_TOKEN"
```

```json
{
  "warnings": {
    "off_streak_days": 3,
    "late_medication_count": 5,
    "fall_or_near_fall_count": 1,
    "fall_with_injury_count": 0,
    "orthostatic_repeat_count": 2,
    "orthostatic_severe_count": 0,
    "severe_event_count": 0
  }
}
```

---

## 6. Standard error shape

Every error response is `{ "error": string, "details"?: object }` — `details` is present for
Zod validation failures (400) and mirrors `ZodError.flatten().fieldErrors`.

```json
{ "error": "Validation failed", "details": { "role": ["Invalid enum value. Expected 'patient' | 'caregiver', received 'admin'"] } }
```
