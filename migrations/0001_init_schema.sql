-- =====================================================================
-- PD Life — Database Schema v3.3  (schema: pdlife)
-- PostgreSQL 15+ / Supabase
--
-- เวอร์ชันนี้ลงใน schema แยก ไม่ปนกับ public
-- ทุกชื่อ object qualify เต็ม (pdlife.xxx) — ไม่พึ่ง search_path
-- จึงรันทีละ statement บน SQL Editor ก็ไม่หลุดไป public
--
-- แก้จาก v3.0:
--   [1] late_minutes : cast เป็น INTEGER (เดิมได้ numeric -> error)
--   [2] age          : ตัดออกจาก patient_profiles (age() ไม่ IMMUTABLE
--                      และ STORED จะค้าง) -> คำนวณใน v_patient_full แทน
--   [3] ลำดับตาราง   : เรียงตาม FK dependency
--   [4] schema       : ย้ายจาก public -> pdlife  (v3.2)
--   [5] audit_logs   : ตัด partition ออก เหลือตารางเดียว (v3.3)
--                      -> ตารางลดจาก 26 เหลือ 20
--
-- ตรวจแล้ว: parse ผ่าน PostgreSQL parser
--           20 tables + 2 views + 22 types
--           ไม่มี FK อ้างตารางที่ยังไม่สร้าง
--           ไม่มี object ไหนหลุดไป public
--
-- !! สำรองข้อมูลก่อนรัน (Supabase -> Database -> Backups)
-- !! รันทั้งไฟล์รวดเดียว
-- =====================================================================


-- =====================================================================
-- SECTION -2 — ถ้าเคยรัน v3.2 ไปแล้ว (มี audit_logs แบบ partition)
--
-- เลือกทางใดทางหนึ่ง เอา -- ออกแล้วรันก่อน จึงค่อยรันไฟล์ที่เหลือ
--
-- ทาง 1) ล้างทั้ง schema เริ่มใหม่ — แนะนำถ้ายังไม่มีข้อมูล
--        (ไม่ลบ role pdlife_app — ถ้ารัน SECTION 12 ซ้ำจะเจอ
--         role already exists ให้ DROP ROLE ก่อน หรือลบบรรทัด CREATE ROLE)
--
-- DROP SCHEMA pdlife CASCADE;
-- DROP ROLE pdlife_app;
--
--
-- ทาง 2) แก้เฉพาะ audit_logs — ถ้ามีข้อมูลตารางอื่นแล้วไม่อยากล้าง
--        CASCADE ลบ partition ลูกทั้ง 6 ตัวให้อัตโนมัติ
--        แล้วข้ามไปรันเฉพาะ SECTION 9.2 + GRANT ด้านล่าง
--
-- SELECT count(*) FROM pdlife.audit_logs;   -- เช็คว่าว่างก่อน
-- DROP TABLE pdlife.audit_logs CASCADE;
--   ...รัน SECTION 9.2 ของไฟล์นี้...
-- GRANT SELECT, INSERT ON pdlife.audit_logs TO pdlife_app;
-- ALTER TABLE pdlife.audit_logs ENABLE ROW LEVEL SECURITY;
--
-- (ต้อง GRANT ใหม่เสมอหลัง DROP+CREATE เพราะสิทธิ์ผูกกับ object
--  ไม่ใช่ชื่อตาราง — ตารางใหม่คนละ oid จึงไม่มีสิทธิ์ติดมา)
-- =====================================================================


-- =====================================================================
-- SECTION -1 — สร้าง SCHEMA
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS pdlife;

COMMENT ON SCHEMA pdlife IS 'PD Life - Parkinson symptom & medication tracking';


-- =====================================================================
-- SECTION 0 — EXTENSIONS & ENUMS
-- ต้องมาก่อนทุกอย่าง เพราะทุกตารางอ้าง type เหล่านี้
-- =====================================================================

-- pgcrypto เป็นระดับ database ไม่ใช่ระดับ schema
-- Supabase ติดตั้งไว้ให้แล้ว บรรทัดนี้จึงมักไม่มีผลอะไร
-- ถ้า error ให้ลบบรรทัดนี้ออกได้เลย
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE pdlife.user_role       AS ENUM ('patient','caregiver','nurse','doctor','admin');
CREATE TYPE pdlife.lang_code       AS ENUM ('th','en');
CREATE TYPE pdlife.gender_type     AS ENUM ('male','female','other');
CREATE TYPE pdlife.diagnosis_type  AS ENUM ('PD','Prodromal','Control','Other');
CREATE TYPE pdlife.platform_type   AS ENUM ('ios','android','web');
CREATE TYPE pdlife.round_status    AS ENUM ('pending','completed','missed','expired');
CREATE TYPE pdlife.respondent_role AS ENUM ('patient','caregiver');
CREATE TYPE pdlife.event_type_enum AS ENUM ('choking','severe_dyskinesia','medication_no_effect','emergency_other');
CREATE TYPE pdlife.severity_enum   AS ENUM ('moderate','severe','critical');
CREATE TYPE pdlife.onoff_enum      AS ENUM ('on','off','unknown');
CREATE TYPE pdlife.med_status      AS ENUM ('active','discontinued','unavailable');
CREATE TYPE pdlife.med_log_status  AS ENUM ('pending','taken','skipped');
CREATE TYPE pdlife.visit_type_enum AS ENUM ('routine','follow_up','urgent','walk_in');
CREATE TYPE pdlife.visit_status    AS ENUM ('scheduled','checked_in','completed','missed','cancelled');
CREATE TYPE pdlife.assess_status   AS ENUM ('draft','submitted','doctor_opened');
CREATE TYPE pdlife.urgency_enum    AS ENUM ('routine','soon','urgent');
CREATE TYPE pdlife.notif_type      AS ENUM ('medication_reminder','round_reminder','previsit_reminder','reminder_2days','reminder_1day');
CREATE TYPE pdlife.notif_trigger   AS ENUM ('after_submit','system');
CREATE TYPE pdlife.delivery_enum   AS ENUM ('queued','sent','failed');
CREATE TYPE pdlife.flag_severity   AS ENUM ('red','urgent');
CREATE TYPE pdlife.audit_action    AS ENUM ('READ','CREATE','UPDATE','DELETE');
CREATE TYPE pdlife.audit_status    AS ENUM ('success','failed');


-- =====================================================================
-- SECTION 1 — USERS & ACCESS (5 ตาราง)
-- users ต้องมาก่อนทุกตารางที่มี patient_id / user_id
-- =====================================================================

-- 1.1 users — ทุกคนในระบบ แยกด้วย role
CREATE TABLE pdlife.users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid           UUID UNIQUE,                 -- เชื่อม Supabase Auth (จำเป็นต่อ RLS)
  first_name         VARCHAR NOT NULL,
  last_name          VARCHAR NOT NULL,
  user_name          VARCHAR UNIQUE NOT NULL,
  role               pdlife.user_role NOT NULL,
  phone_number       VARCHAR,
  password_hash      VARCHAR,                     -- ใช้เมื่อไม่ผ่าน Supabase Auth
  preferred_language pdlife.lang_code DEFAULT 'th',
  last_login_at      TIMESTAMPTZ,
  is_active          BOOLEAN DEFAULT true,        -- soft delete
  deactivated_at     TIMESTAMPTZ,
  app_version        VARCHAR,
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- 1.2 patient_profiles — ข้อมูลเฉพาะผู้ป่วย 1:1 กับ users
-- [แก้ 2] ตัดคอลัมน์ age ออก → คำนวณใน v_patient_full แทน
CREATE TABLE pdlife.patient_profiles (
  user_id          UUID PRIMARY KEY REFERENCES pdlife.users(id) ON DELETE CASCADE,
  id_card_number   VARCHAR UNIQUE,
  hn_number        VARCHAR UNIQUE,
  gender           pdlife.gender_type,
  date_of_birth    DATE NOT NULL,
  diagnosis_date   DATE,
  diagnosis        pdlife.diagnosis_type,
  other_diagnosis  TEXT,
  hoehn_yahr_stage SMALLINT CHECK (hoehn_yahr_stage BETWEEN 1 AND 5),
  wake_time        TIME NOT NULL,                 -- trigger MORNING_CHECKIN
  sleep_time       TIME NOT NULL,                 -- trigger EVENING_DAILY_CORE
  province         VARCHAR,
  registered_at    TIMESTAMPTZ DEFAULT now()
);

-- index รองรับการ filter ตามอายุ (แทน index บนคอลัมน์ age เดิม)
CREATE INDEX idx_patient_dob ON pdlife.patient_profiles (date_of_birth);

-- 1.3 patient_caregivers — ผูกผู้ป่วย–ผู้ดูแล M:N (ฐานของ RLS)
CREATE TABLE pdlife.patient_caregivers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   UUID NOT NULL REFERENCES pdlife.users(id) ON DELETE CASCADE,
  caregiver_id UUID NOT NULL REFERENCES pdlife.users(id) ON DELETE CASCADE,
  relationship VARCHAR,
  can_answer   BOOLEAN DEFAULT true,   -- false = ดูอย่างเดียว
  is_primary   BOOLEAN DEFAULT false,
  active       BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (patient_id, caregiver_id)
);

-- index สำหรับ RLS policy (เตรียมไว้ล่วงหน้า)
CREATE INDEX idx_caregiver_lookup ON pdlife.patient_caregivers (caregiver_id, patient_id)
  WHERE active;

-- 1.4 devices — Expo push token (1 คนหลายเครื่อง)
CREATE TABLE pdlife.devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES pdlife.users(id) ON DELETE CASCADE,
  expo_push_token VARCHAR UNIQUE NOT NULL,
  platform        pdlife.platform_type NOT NULL,
  app_version     VARCHAR,
  push_enabled    BOOLEAN DEFAULT true,
  last_seen_at    TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_devices_active ON pdlife.devices (user_id) WHERE push_enabled;

-- 1.5 consents — PDPA append-only เก็บทุกเวอร์ชัน
CREATE TABLE pdlife.consents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES pdlife.users(id) ON DELETE CASCADE,
  consent_type VARCHAR NOT NULL,      -- pdpa / data_sharing / research
  version      VARCHAR NOT NULL,
  accepted     BOOLEAN NOT NULL,
  accepted_at  TIMESTAMPTZ DEFAULT now(),
  ip_address   INET
);


-- =====================================================================
-- SECTION 2 — QUESTION CONFIG (3 ตาราง)
-- ไม่มี FK ไป users · ต้องมาก่อน responses และ red_flags
-- seed จาก PDLIFE_Question_Bank_master
-- =====================================================================

-- 2.1 question_bank — คลังคำถาม ~50 ข้อ
CREATE TABLE pdlife.question_bank (
  question_code       VARCHAR PRIMARY KEY,        -- เช่น MED_ONOFF_NOW
  qid                 VARCHAR UNIQUE,             -- เช่น MED-01
  item_no             SMALLINT,
  domain_code         VARCHAR NOT NULL,
  domain_name_th      VARCHAR,
  question_full_th    TEXT NOT NULL,
  question_short_th   VARCHAR,
  answer_type         VARCHAR NOT NULL,           -- likert/yes_no/single/multi/number/text
  options_json        JSONB DEFAULT '[]'::jsonb,
  condition_json      JSONB DEFAULT '{}'::jsonb,
  red_flag_json       JSONB DEFAULT '{}'::jsonb,
  respondent          VARCHAR DEFAULT 'both',     -- patient_only/caregiver_preferred/both
  ui_input_hint       VARCHAR,
  required_level      VARCHAR,
  summary_metric      VARCHAR,
  mds_reference       VARCHAR,
  license_source      VARCHAR,
  terminology_binding VARCHAR,
  mvp_phase           VARCHAR,
  version             INTEGER DEFAULT 1,          -- เพิ่มเมื่อแก้ถ้อยคำ
  active              BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- 2.2 checkin_templates — 7 รอบ
CREATE TABLE pdlife.checkin_templates (
  template_code        VARCHAR PRIMARY KEY,
  template_name_th     VARCHAR NOT NULL,
  purpose              TEXT,
  trigger_type         VARCHAR NOT NULL,
  window_minutes       SMALLINT,                  -- ใช้คำนวณ expires_at
  max_questions_target SMALLINT,
  notification_copy_th TEXT,
  mvp_phase            VARCHAR,
  active               BOOLEAN DEFAULT true
);

-- 2.3 template_questions — single source of truth ว่าข้อไหนอยู่รอบไหน
CREATE TABLE pdlife.template_questions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_code  VARCHAR NOT NULL REFERENCES pdlife.checkin_templates(template_code),
  question_code  VARCHAR NOT NULL REFERENCES pdlife.question_bank(question_code),
  sort_order     DECIMAL(4,1) NOT NULL,           -- ทศนิยมได้ เช่น 8.5
  required       BOOLEAN DEFAULT false,
  condition_json JSONB DEFAULT '{}'::jsonb,
  ui_note_th     TEXT,
  UNIQUE (template_code, question_code)
);

CREATE INDEX idx_template_questions_order
  ON pdlife.template_questions (template_code, sort_order);


-- =====================================================================
-- SECTION 3 — MEDICATION MASTER (1 ตาราง)
-- ต้องมาก่อน patient_medications
-- =====================================================================

-- 3.1 medications — master list ยาทั้งระบบ
-- [ข้อสังเกต] ledd_factor ขยายเป็น (6,4) รองรับยาที่ factor เล็กมาก
CREATE TABLE pdlife.medications (
  id                  VARCHAR PRIMARY KEY CHECK (id ~ '^MED-[0-9]{3}$'),
  drug_name           VARCHAR NOT NULL,
  drug_generic_name   VARCHAR,
  drug_thai_name      VARCHAR,
  medication_class    VARCHAR,
  drug_form           VARCHAR,
  strength            VARCHAR,
  drug_quantity       VARCHAR,
  dosage_instructions TEXT,
  side_effects        TEXT,
  contraindications   TEXT,
  interactions        TEXT,
  ledd_factor         DECIMAL(6,4),
  status              pdlife.med_status DEFAULT 'active',
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);


-- =====================================================================
-- SECTION 4 — CLINIC: APPOINTMENTS (1 ตาราง)
-- [แก้ 3] ย้ายมาก่อน patient_medications เพราะ visit_id อ้างตารางนี้
-- =====================================================================

-- 4.1 appointments — visit_date เป็นตัวเปิดหน้าต่าง EMA 7 วัน
CREATE TABLE pdlife.appointments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id           UUID NOT NULL REFERENCES pdlife.users(id) ON DELETE CASCADE,
  doctor_id            UUID REFERENCES pdlife.users(id),
  visit_date           DATE NOT NULL,
  visit_time           TIME,
  visit_type           pdlife.visit_type_enum,
  status               pdlife.visit_status DEFAULT 'scheduled',
  created_by           UUID REFERENCES pdlife.users(id),
  created_appoint_name VARCHAR,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_appointments_window ON pdlife.appointments (patient_id, visit_date);


-- =====================================================================
-- SECTION 5 — PRESCRIPTION & MEDICATION LOGS (2 ตาราง)
-- =====================================================================

-- 5.1 patient_medications — หัวใจของ scheduler
CREATE TABLE pdlife.patient_medications (
  prescription_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id               UUID NOT NULL REFERENCES pdlife.users(id) ON DELETE CASCADE,
  prescribed_by            UUID REFERENCES pdlife.users(id),
  prescribed_by_name       VARCHAR,
  visit_id                 UUID REFERENCES pdlife.appointments(id),
  medication_id            VARCHAR NOT NULL REFERENCES pdlife.medications(id),
  scheduled_times          TIME[] NOT NULL,                 -- source of truth ของเวลากินยา
  doses                    JSONB DEFAULT '{}'::jsonb,       -- key ตรงกับ scheduled_times
  frequency                VARCHAR,
  special_instructions     TEXT,
  active                   BOOLEAN DEFAULT true,
  previous_prescription_id UUID REFERENCES pdlife.patient_medications(prescription_id),
  start_date               DATE NOT NULL,
  end_date                 DATE,
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_active_prescriptions
  ON pdlife.patient_medications (patient_id) WHERE active;

-- 5.2 medication_logs — บันทึกว่ากินยาจริงเมื่อไหร่
-- [แก้ 1] cast late_minutes เป็น INTEGER ให้ชัด · taken_at NULL → ค่าเป็น NULL
CREATE TABLE pdlife.medication_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID NOT NULL REFERENCES pdlife.users(id) ON DELETE CASCADE,
  prescription_id UUID NOT NULL REFERENCES pdlife.patient_medications(prescription_id),
  planned_at      TIMESTAMPTZ NOT NULL,
  taken_at        TIMESTAMPTZ,
  dose_taken      VARCHAR,
  late_minutes    INTEGER GENERATED ALWAYS AS
                    ((EXTRACT(EPOCH FROM (taken_at - planned_at)) / 60)::INTEGER) STORED,
  status          pdlife.med_log_status DEFAULT 'pending',
  note            TEXT,
  submitted_at    TIMESTAMPTZ,
  received_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_med_logs_patient_time ON pdlife.medication_logs (patient_id, planned_at);
CREATE INDEX idx_med_logs_pending      ON pdlife.medication_logs (status, planned_at)
  WHERE status = 'pending';


-- =====================================================================
-- SECTION 6 — ROUNDS & RESPONSES (3 ตาราง)
-- ต้องมาหลัง medication_logs / appointments / checkin_templates
-- =====================================================================

-- 6.1 round_instances — 1 แถว = 1 รอบที่ระบบสร้างให้ผู้ป่วย
CREATE TABLE pdlife.round_instances (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        UUID NOT NULL REFERENCES pdlife.users(id) ON DELETE CASCADE,
  template_code     VARCHAR NOT NULL REFERENCES pdlife.checkin_templates(template_code),
  prescription_id   UUID REFERENCES pdlife.patient_medications(prescription_id),
  target_dose_at    TIMESTAMPTZ,
  medication_log_id UUID REFERENCES pdlife.medication_logs(id),
  appointment_id    UUID REFERENCES pdlife.appointments(id),
  scheduled_at      TIMESTAMPTZ NOT NULL,
  expires_at        TIMESTAMPTZ,                  -- พ้นเวลานี้ = ตอบไม่ได้ (FR P7)
  completed_at      TIMESTAMPTZ,
  status            pdlife.round_status DEFAULT 'pending',
  answered_by       UUID REFERENCES pdlife.users(id),
  submitted_at      TIMESTAMPTZ,
  received_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_rounds_patient_time ON pdlife.round_instances (patient_id, scheduled_at);
CREATE INDEX idx_rounds_sweep        ON pdlife.round_instances (status, scheduled_at);

-- 6.2 responses — คำตอบทุกข้อทุกรอบ (ตารางที่โตเร็วที่สุด)
CREATE TABLE pdlife.responses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        UUID NOT NULL REFERENCES pdlife.users(id) ON DELETE CASCADE,
  round_instance_id UUID NOT NULL REFERENCES pdlife.round_instances(id) ON DELETE CASCADE,
  question_code     VARCHAR NOT NULL REFERENCES pdlife.question_bank(question_code),
  question_version  INTEGER NOT NULL DEFAULT 1,
  answer_value      JSONB NOT NULL,               -- {"choice":"often","score":2}
  skipped           BOOLEAN DEFAULT false,
  answered_by_role  pdlife.respondent_role NOT NULL,
  answered_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (round_instance_id, question_code)
);

CREATE INDEX idx_responses_patient_time ON pdlife.responses (patient_id, answered_at);
CREATE INDEX idx_responses_question     ON pdlife.responses (question_code, answered_at);

-- 6.3 event_logs — เหตุฉุกเฉินนอกรอบคำถามเท่านั้น (ตัด fall ออกแล้ว)
CREATE TABLE pdlife.event_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID NOT NULL REFERENCES pdlife.users(id) ON DELETE CASCADE,
  recorded_by     UUID REFERENCES pdlife.users(id),
  event_type      pdlife.event_type_enum NOT NULL,
  severity        pdlife.severity_enum NOT NULL,
  injury_occurred BOOLEAN DEFAULT false,
  required_er     BOOLEAN DEFAULT false,
  on_off_time     pdlife.onoff_enum,
  occurred_at     TIMESTAMPTZ NOT NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_event_logs_patient ON pdlife.event_logs (patient_id, occurred_at);


-- =====================================================================
-- SECTION 7 — CLINIC FORMS (2 ตาราง)
-- =====================================================================

-- 7.1 clinic_assessments — แบบฟอร์มพยาบาล 26 คอลัมน์ BOOLEAN
CREATE TABLE pdlife.clinic_assessments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id           UUID NOT NULL REFERENCES pdlife.appointments(id),
  patient_id               UUID NOT NULL REFERENCES pdlife.users(id),
  nurse_id                 UUID REFERENCES pdlife.users(id),
  -- Motor (4)
  motor_tremor             BOOLEAN DEFAULT false,
  motor_rigidity           BOOLEAN DEFAULT false,
  motor_bradykinesia       BOOLEAN DEFAULT false,
  motor_gait_dysfunction   BOOLEAN DEFAULT false,
  -- Speech (1)
  speech_swallowing        BOOLEAN DEFAULT false,
  -- GI (3)
  gi_drooling              BOOLEAN DEFAULT false,
  gi_dysphagia             BOOLEAN DEFAULT false,
  gi_constipation          BOOLEAN DEFAULT false,
  -- ANS (3)
  ans_oh                   BOOLEAN DEFAULT false,
  ans_urinary              BOOLEAN DEFAULT false,
  ans_sexual               BOOLEAN DEFAULT false,
  -- Sleep (4)
  sleep_insomnia           BOOLEAN DEFAULT false,
  sleep_rbd                BOOLEAN DEFAULT false,
  sleep_nocturia           BOOLEAN DEFAULT false,
  sleep_eds                BOOLEAN DEFAULT false,
  -- Neuropsychiatric (5)
  neuro_anxiety            BOOLEAN DEFAULT false,
  neuro_depression         BOOLEAN DEFAULT false,
  neuro_hallucination      BOOLEAN DEFAULT false,
  neuro_dementia           BOOLEAN DEFAULT false,
  neuro_icds               BOOLEAN DEFAULT false,
  -- Motor fluctuation (6)
  mf_wearing_off           BOOLEAN DEFAULT false,
  mf_delay_on              BOOLEAN DEFAULT false,
  mf_suboptimal_on         BOOLEAN DEFAULT false,
  mf_early_morning_off     BOOLEAN DEFAULT false,
  mf_dyskinesia            BOOLEAN DEFAULT false,
  mf_nocturnal_hypokinesia BOOLEAN DEFAULT false,
  --
  has_caregiver            BOOLEAN DEFAULT false,
  other_note               TEXT,
  screened_by              VARCHAR,
  status                   pdlife.assess_status DEFAULT 'draft',
  submitted_at             TIMESTAMPTZ,
  doctor_opened_at         TIMESTAMPTZ
);

CREATE INDEX idx_assessments_appointment ON pdlife.clinic_assessments (appointment_id);

-- 7.2 doctor_notes — appointment_id เป็นตัวหลัก (รองรับ walk-in)
CREATE TABLE pdlife.doctor_notes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id        UUID NOT NULL REFERENCES pdlife.appointments(id),
  assessment_id         UUID REFERENCES pdlife.clinic_assessments(id),
  doctor_id             UUID NOT NULL REFERENCES pdlife.users(id),
  clinical_note         TEXT,
  medication_adjustment BOOLEAN DEFAULT false,
  reason_for_change     TEXT,
  follow_up_urgency     pdlife.urgency_enum,
  next_appointment_date DATE,
  created_at            TIMESTAMPTZ DEFAULT now()
);


-- =====================================================================
-- SECTION 8 — NOTIFICATIONS (1 ตาราง)
-- ต้องมาหลัง devices / round_instances / medication_logs / appointments
-- =====================================================================

CREATE TABLE pdlife.notifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES pdlife.users(id) ON DELETE CASCADE,  -- ผู้รับ
  patient_id          UUID NOT NULL REFERENCES pdlife.users(id) ON DELETE CASCADE,  -- เรื่องผู้ป่วยคนไหน
  device_id           UUID REFERENCES pdlife.devices(id),
  round_instance_id   UUID REFERENCES pdlife.round_instances(id),
  prescription_id     UUID REFERENCES pdlife.patient_medications(prescription_id),
  medication_log_id   UUID REFERENCES pdlife.medication_logs(id),
  appointment_id      UUID REFERENCES pdlife.appointments(id),
  type                pdlife.notif_type NOT NULL,
  trigger_type        pdlife.notif_trigger,
  questions_remaining SMALLINT,
  triggered_at        TIMESTAMPTZ DEFAULT now(),
  sent_at             TIMESTAMPTZ,
  delivery_status     pdlife.delivery_enum DEFAULT 'queued',
  is_read             BOOLEAN DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_notif_queue ON pdlife.notifications (delivery_status, triggered_at)
  WHERE delivery_status = 'queued';
CREATE INDEX idx_notif_unread ON pdlife.notifications (user_id, is_read)
  WHERE NOT is_read;


-- =====================================================================
-- SECTION 9 — SAFETY & COMPLIANCE (3 ตาราง)
-- red_flags ต้องมาหลัง responses + event_logs + question_bank
-- =====================================================================

-- 9.1 red_flags — คิว urgent บน dashboard
CREATE TABLE pdlife.red_flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID NOT NULL REFERENCES pdlife.users(id) ON DELETE CASCADE,
  response_id   UUID REFERENCES pdlife.responses(id) ON DELETE CASCADE,
  event_log_id  UUID REFERENCES pdlife.event_logs(id) ON DELETE CASCADE,
  question_code VARCHAR REFERENCES pdlife.question_bank(question_code),
  clinic_tag    VARCHAR NOT NULL,           -- suicidal_ideation / fall_injury / ...
  severity      pdlife.flag_severity NOT NULL,     -- เฉพาะ red / urgent
  reviewed      BOOLEAN DEFAULT false,
  reviewed_by   UUID REFERENCES pdlife.users(id),
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_red_flags_queue ON pdlife.red_flags (reviewed, severity, created_at);

-- 9.2 audit_logs — append-only (ตารางเดียว ไม่ partition)
--
-- [เปลี่ยนใน v3.3] เดิมใช้ PARTITION BY RANGE รายเดือน + 6 partition
--   prototype ยังไม่ต้องการ — Postgres รับได้สบายถึงหลักล้านแถว
--   และ partition ทำให้มีตารางย่อยเพิ่มปีละ 12 ตาราง รกหน้า dashboard
--
-- เมื่อไหร่ควรกลับมา partition:
--   - ข้อมูลถึง ~5 ล้านแถว หรือ
--   - DPO ยืนยันว่าต้อง log ทุก READ และเก็บย้อนหลังหลายปี
--   ตอนนั้นต้อง migrate ข้อมูลเดิม (ยุ่งกว่าทำตั้งแต่แรก แต่ทำได้)
--
-- PK ใช้ id เดี่ยวได้แล้ว เพราะ partition table เท่านั้นที่บังคับให้
-- partition key ต้องอยู่ใน PK ด้วย
CREATE TABLE pdlife.audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES pdlife.users(id),
  action       pdlife.audit_action NOT NULL,
  status       pdlife.audit_status NOT NULL,
  target_table VARCHAR NOT NULL,
  target_id    UUID,
  old_value    JSONB,
  new_value    JSONB,
  ip_address   INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_user_time ON pdlife.audit_logs (user_id, created_at);
CREATE INDEX idx_audit_time      ON pdlife.audit_logs (created_at);
CREATE INDEX idx_audit_target    ON pdlife.audit_logs (target_table, target_id);


-- =====================================================================
-- SECTION 10 — VIEWS (2 view)
-- ต้องมาสุดท้าย เพราะอ้างตารางทั้งหมด
-- security_invoker = true → view สืบทอด RLS จากตารางต้นทาง (สำคัญมาก)
-- =====================================================================

-- 10.1 v_patient_full — ข้อมูลผู้ป่วยครบโดยไม่ต้อง JOIN
-- [แก้ 2] คำนวณ age ที่นี่แทนคอลัมน์ GENERATED → อัปเดตทุกครั้งที่อ่าน
CREATE VIEW pdlife.v_patient_full
WITH (security_invoker = true) AS
SELECT
  u.id,
  u.first_name,
  u.last_name,
  u.phone_number,
  p.hn_number,
  p.gender,
  p.date_of_birth,
  EXTRACT(YEAR FROM age(p.date_of_birth))::SMALLINT AS age,
  p.diagnosis,
  p.diagnosis_date,
  p.hoehn_yahr_stage,
  p.wake_time,
  p.sleep_time,
  p.province,
  p.registered_at,
  (SELECT count(*) FROM pdlife.patient_caregivers pc
    WHERE pc.patient_id = u.id AND pc.active) AS caregiver_count
FROM pdlife.users u
JOIN pdlife.patient_profiles p ON p.user_id = u.id
WHERE u.is_active;

-- 10.2 v_onoff_timeline — กราฟ Hauser (FR C2)
CREATE VIEW pdlife.v_onoff_timeline
WITH (security_invoker = true) AS
SELECT
  r.patient_id,
  r.answered_at AS ts,
  ri.template_code,
  ri.prescription_id,
  ri.target_dose_at,
  MAX(CASE WHEN r.question_code = 'MED_ONOFF_NOW'
           THEN r.answer_value->>'choice' END) AS state,
  MAX(CASE WHEN r.question_code = 'MED_DYSKINESIA_NOW'
           THEN r.answer_value->>'choice' END) AS dyskinesia,
  MAX(CASE WHEN r.question_code = 'MED_ADHERENCE'
           THEN r.answer_value->>'choice' END) AS adherence
FROM pdlife.responses r
JOIN pdlife.round_instances ri ON ri.id = r.round_instance_id
WHERE r.question_code IN ('MED_ONOFF_NOW','MED_DYSKINESIA_NOW','MED_ADHERENCE')
GROUP BY r.patient_id, r.answered_at, ri.template_code,
         ri.prescription_id, ri.target_dose_at;


-- =====================================================================
-- SECTION 11 — RLS PLACEHOLDER (ยังไม่เปิดตามที่ตกลง)
-- =====================================================================
-- ตอนนี้ยังไม่เปิด RLS ตามที่ทีมตัดสินใจ (dev phase, ข้อมูล dummy)
-- ข้อควรทำระหว่างนี้:
--   1) ให้แอปเรียกผ่าน backend ที่ถือ service key เท่านั้น อย่าเปิด anon key ให้ client
--   2) เซ็ต users.auth_uid ทุกครั้งที่สร้าง user (ไม่งั้นวันเปิด RLS ต้อง backfill)
--   3) อย่าเขียนโค้ดที่ query ข้ามผู้ป่วยแล้ว filter ในแอป
--
-- เมื่อพร้อมเปิด ให้รันตามลำดับเฟส:
--   เฟส 1 config → เฟส 2 users/access → เฟส 3 clinic
--   → เฟส 4 rounds/responses → เฟส 5 safety
--
-- ทางลัดปิดรูรั่วทันทีโดยยังไม่ต้องเขียน policy (anon เข้าไม่ได้ service key เข้าได้):
--   ALTER TABLE responses ENABLE ROW LEVEL SECURITY;
--   ... (ทำกับทุกตารางที่มี patient_id)
-- =====================================================================


-- =====================================================================
-- จบไฟล์ — 20 ตาราง · 2 view · 6 กลุ่ม
-- ยังไม่ได้แก้: dedupe PRE_NEXT_MED (ระดับ app logic)
--             · ลดข้อ EVENING 17→6 (ระดับ config seed)
-- =====================================================================


-- =====================================================================
-- SECTION 12 — GRANT / REVOKE  (รันหลังสร้างตารางครบ)
--
-- เป้าหมาย: backend ของ PD Life แตะได้เฉพาะ schema pdlife
--          ต่อให้เขียนโค้ดผิดก็ไม่ทะลุไป public
--
-- !! เปลี่ยน '<ใส่รหัสผ่านที่แข็งแรง>' ก่อนรัน
-- !! เก็บรหัสใน env var ห้าม commit ลง git
-- =====================================================================

-- 12.1 สร้าง role สำหรับ backend
CREATE ROLE pdlife_app LOGIN PASSWORD '<ใส่รหัสผ่านที่แข็งแรง>';

-- 12.2 ให้สิทธิ์เฉพาะ schema pdlife
GRANT USAGE ON SCHEMA pdlife TO pdlife_app;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA pdlife TO pdlife_app;

GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA pdlife TO pdlife_app;

-- 12.3 ตารางที่สร้างเพิ่มทีหลังก็ได้สิทธิ์อัตโนมัติ
ALTER DEFAULT PRIVILEGES IN SCHEMA pdlife
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pdlife_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA pdlife
  GRANT USAGE, SELECT ON SEQUENCES TO pdlife_app;

-- 12.4 audit_logs ต้อง append-only — บังคับที่ระดับ DB ไม่ใช่แค่ไม่มี endpoint
REVOKE UPDATE, DELETE ON pdlife.audit_logs FROM pdlife_app;

-- [v3.3] ตัด ALTER DEFAULT PRIVILEGES ... REVOKE ออกแล้ว
--   เดิมมีไว้กัน partition ใหม่ที่เกิดทุกเดือน — ตอนนี้ไม่มี partition แล้ว
--   จึงไม่ต้องใช้ และมันตัดสิทธิ์ตารางใหม่ทั้งหมดโดยไม่ตั้งใจด้วย

-- 12.5 ตัดสิทธิ์ schema อื่นให้แน่ใจ (สำคัญที่สุดของ section นี้)
REVOKE ALL ON SCHEMA public FROM pdlife_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM pdlife_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM pdlife_app;

-- 12.6 ล็อก search_path — กัน query หลุดไป schema อื่นโดยไม่ตั้งใจ
ALTER ROLE pdlife_app SET search_path = pdlife;


-- =====================================================================
-- SECTION 13 — QUERY ตรวจสอบหลังรัน (รันทีละอัน ดูผลเอง)
-- =====================================================================

-- 13.1 ต้องได้ 20 tables + 2 views
--
-- SELECT table_type, count(*)
-- FROM information_schema.tables
-- WHERE table_schema = 'pdlife'
-- GROUP BY table_type;

-- 13.2 ต้องไม่มีอะไรใหม่โผล่ใน public
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;

-- 13.3 ต้องเห็น 22 ENUM อยู่ใน pdlife ทั้งหมด
--
-- SELECT n.nspname, count(*)
-- FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
-- WHERE t.typtype = 'e' AND n.nspname NOT IN ('pg_catalog','information_schema')
-- GROUP BY n.nspname;

-- 13.4 ทดสอบว่า role กันข้าม schema ได้จริง
--     บรรทัดที่ 2 ต้อง error: permission denied
--
-- SET ROLE pdlife_app;
-- SELECT * FROM public.<ตารางใน schema เดิม> LIMIT 1;
-- RESET ROLE;

-- 13.5 ทดสอบ late_minutes ว่า GENERATED ทำงานจริง
--     (ต้อง insert users -> medications -> patient_medications ก่อน)
--     คาดหวัง: taken_at NULL -> late_minutes NULL
--              taken_at ช้า 15 นาที -> late_minutes = 15


-- =====================================================================
-- SECTION 14 — ถ้าต้องล้างเริ่มใหม่
-- คำสั่งนี้ลบเฉพาะ pdlife ไม่แตะ schema อื่น
-- =====================================================================
--
-- DROP SCHEMA pdlife CASCADE;
-- DROP ROLE pdlife_app;


-- =====================================================================
-- งานที่เหลือหลังรันไฟล์นี้
--   1) seed question_bank (~50 ข้อ)
--   2) seed checkin_templates (7 รอบ)      <- ต้องหลัง 1
--   3) seed template_questions             <- ต้องหลัง 1 และ 2
--   4) seed medications (รหัสต้องตรง MED-###)
--   5) สร้าง user ทดสอบ: patient + caregiver + nurse + doctor
--
-- ยังไม่ได้ทำ (ระดับ app ไม่ใช่ DB):
--   - dedupe PRE_NEXT_MED เมื่อยาหลายตัวชนเวลาเดียวกัน
--   - ลดข้อ EVENING_DAILY_CORE 17 -> 6 (แก้แถวใน template_questions)
--   - assertCanAccessPatient() ที่ backend (แทน RLS)
-- =====================================================================
