-- ============================================================================
-- ข้อมูลทดสอบสำหรับฟีเจอร์ "เทียบแอป vs พยาบาล" (GET .../dashboard/app-answers)
-- ============================================================================
--
-- ⚠️ รันเฉพาะในโปรเจกต์ทดสอบ (oibjuxjiaftkcdhxyvuh, schema `pdlife`) เท่านั้น
--    ห้ามรันกับโปรเจกต์ข้อมูลผู้ป่วยจริง (mieiwzfhohifeprjtnek, schema `core`/`checkpd`)
--    ถ้ารันผิดโปรเจกต์ statement จะ error ทันทีเพราะ schema `pdlife` ไม่มีอยู่ที่นั่น —
--    เป็นตาข่ายกันพลาดในตัวอยู่แล้ว แต่ตรวจ SUPABASE_URL ก่อนวางในนี้เสมอ (ดู docs/HANDOVER.md §2)
--
-- สร้างผู้ป่วย 2 คน (คนละ users/patient_profiles ของตัวเอง ไม่ชนกับ seed อื่น) พร้อม
-- นัดที่มีฟอร์มคัดกรองของพยาบาลแล้ว (clinic_assessments) และคำตอบจากแอปครบทั้ง 23 คำถาม
-- ที่แมปกับฟอร์ม 26 ข้อ (src/config/constants.ts — ASSESSMENT_KEY_QUESTION_CODES)
-- ตั้งใจให้ทั้งสองคน "ไม่เหมือนกัน" เพื่อทดสอบทั้งสองเคส:
--
--   ผู้ป่วย A "ตรงกันหมด"      — ควรเห็นตาราง cross-check ว่าง ไม่มีข้อไม่ตรงกันเลย
--   ผู้ป่วย B "มีจุดไม่ตรงกันชัดเจน" — 5 ข้อไม่ตรง (จงใจ ล้อกับสถานการณ์ตัวอย่างที่เคยใช้ตอน
--                                    ยังเป็น mock: nurse เจอ/ไม่เจอสิ่งที่แอปจับได้ต่างกัน)
--
-- (ระหว่างเขียนไฟล์นี้เจอว่า SLEEP_NOCTURIA choice "c1" เคยถูกนับ flagged ผิดพลาด — แก้แล้วที่
-- src/config/constants.ts NON_STANDARD_BASELINE_CHOICE ก่อน commit ไฟล์นี้ ผู้ป่วย A ข้อ 12
-- ด้านล่างตอนนี้ได้ flagged:false ถูกต้องแล้ว)
--
-- ลบข้อมูลชุดนี้ทั้งหมด (WHERE user_name LIKE 'mock_crosscheck_%'):
--   DELETE FROM pdlife.users WHERE user_name LIKE 'mock_crosscheck_%';
--   -- ON DELETE CASCADE ของ patient_profiles/appointments/clinic_assessments/round_instances/
--   -- responses ที่อ้าง patient_id นี้จะตามไปลบให้เอง (ดู migrations/0001_init_schema.sql)
--   -- ยกเว้น doctor/nurse ที่ถูกอ้างจาก appointments.doctor_id (FK ไม่มี CASCADE) — ลบคนไข้
--   -- ก่อนแล้วค่อยลบหมอ/พยาบาลทดสอบทีหลังถ้าต้องการ
--
-- ============================================================================

DO $$
DECLARE
  v_doctor      UUID;
  v_nurse       UUID;
  v_patient_a   UUID;
  v_patient_b   UUID;
  v_appt_a      UUID;
  v_appt_b      UUID;
  v_round_a     UUID;
  v_round_b     UUID;
BEGIN

  -- ---------- บุคลากร (ใช้ร่วมกันทั้งสองเคส) ----------
  INSERT INTO pdlife.users (first_name, last_name, user_name, role)
  VALUES ('นายแพทย์ทดสอบ', 'ครอสเช็ค', 'mock_crosscheck_doctor', 'doctor')
  RETURNING id INTO v_doctor;

  INSERT INTO pdlife.users (first_name, last_name, user_name, role)
  VALUES ('พยาบาลกาญจนา', 'ดวงแก้ว', 'mock_crosscheck_nurse', 'nurse')
  RETURNING id INTO v_nurse;

  -- ================================================================
  -- ผู้ป่วย A — "แทบตรงกันหมด"
  -- ================================================================

  INSERT INTO pdlife.users (first_name, last_name, user_name, role)
  VALUES ('ทดสอบ เอ', 'ครอสเช็ค', 'mock_crosscheck_patient_a', 'patient')
  RETURNING id INTO v_patient_a;

  INSERT INTO pdlife.patient_profiles
    (user_id, hn_number, gender, date_of_birth, diagnosis, diagnosis_date, hoehn_yahr_stage, wake_time, sleep_time, province)
  VALUES
    (v_patient_a, 'HN-XCHK-A', 'male', '1958-04-12', 'PD', '2019-06-01', 2, '06:30', '21:30', 'กรุงเทพมหานคร');

  INSERT INTO pdlife.appointments (patient_id, doctor_id, created_by, visit_date, visit_time, visit_type, status)
  VALUES (v_patient_a, v_doctor, v_doctor, (current_date - 2), '09:30', 'follow_up', 'completed')
  RETURNING id INTO v_appt_a;

  INSERT INTO pdlife.clinic_assessments (
    appointment_id, patient_id, nurse_id,
    motor_tremor, motor_rigidity, motor_bradykinesia, motor_gait_dysfunction,
    speech_swallowing,
    gi_drooling, gi_dysphagia, gi_constipation,
    ans_oh, ans_urinary, ans_sexual,
    sleep_insomnia, sleep_rbd, sleep_nocturia, sleep_eds,
    neuro_anxiety, neuro_depression, neuro_hallucination, neuro_dementia, neuro_icds,
    mf_wearing_off, mf_delay_on, mf_suboptimal_on, mf_early_morning_off, mf_dyskinesia, mf_nocturnal_hypokinesia,
    has_caregiver, other_note, screened_by, status, submitted_at
  ) VALUES (
    v_appt_a, v_patient_a, v_nurse,
    true, false, false, false,
    false,
    false, false, false,
    false, false, false,
    true, false, false, false,
    true, true, false, false, false,
    true, false, false, false, false, false,
    false, 'ผู้ป่วยมาคนเดียว อาการโดยรวมคงที่', 'พยาบาลกาญจนา ดวงแก้ว', 'submitted', now() - interval '2 days'
  );

  INSERT INTO pdlife.round_instances (patient_id, template_code, appointment_id, scheduled_at, status, completed_at)
  VALUES (v_patient_a, 'PREVISIT_7D_FORM', v_appt_a, now() - interval '2 days', 'completed', now() - interval '2 days')
  RETURNING id INTO v_round_a;

  INSERT INTO pdlife.responses (patient_id, round_instance_id, question_code, answer_value, answered_by_role, answered_at) VALUES
    (v_patient_a, v_round_a, 'MOTOR_TREMOR_IMPACT',          '{"choice":"1","score":1}'::jsonb,        'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'MOTOR_WALK_BALANCE',           '{"choice":"0","score":0}'::jsonb,        'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'ADL_SPEECH_CLARITY',           '{"choice":"0","score":0}'::jsonb,        'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'ADL_DROOLING',                 '{"choice":"0","score":0}'::jsonb,        'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'ADL_SWALLOWING',                '{"choice":"0","score":0}'::jsonb,       'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'AUTO_CONSTIPATION',            '{"choice":"no","score":null}'::jsonb,    'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'AUTO_ORTHOSTATIC_SYMPTOM',     '{"choice":"no","score":0}'::jsonb,       'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'AUTO_URINARY_SYMPTOM',         '{"choice":"0","score":0}'::jsonb,        'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'AUTO_SEXUAL_CONCERN',          '{"choice":"no","score":null}'::jsonb,    'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'SLEEP_QUALITY',                '{"choice":"1","score":1}'::jsonb,        'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'SLEEP_RBD_OBSERVED',           '{"choice":"no","score":null}'::jsonb,    'patient', now() - interval '2 days'),
    -- "c1" = 0 ครั้ง (ไม่มีอาการ) — ทดสอบ NON_STANDARD_BASELINE_CHOICE ว่า flagged:false ถูกต้อง
    (v_patient_a, v_round_a, 'SLEEP_NOCTURIA',               '{"choice":"c1","score":null}'::jsonb,    'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'SLEEP_DAYTIME_SLEEPINESS',     '{"choice":"0","score":0}'::jsonb,        'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'MOOD_ANXIETY',                 '{"choice":"1","score":1}'::jsonb,        'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'MOOD_DEPRESSED_ANHEDONIA',     '{"choice":"1","score":1}'::jsonb,        'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'COG_HALLUCINATION',            '{"choice":"no","score":null}'::jsonb,    'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'COG_MEMORY',                   '{"choice":"0","score":0}'::jsonb,        'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'MOOD_IMPULSE_CONTROL',         '{"choice":"no","score":null}'::jsonb,    'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'MED_WEARING_OFF',              '{"choice":"yes","score":null}'::jsonb,   'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'MED_DELAYED_OR_SUBOPTIMAL_ON', '{"choice":"no","score":null}'::jsonb,    'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'MED_EARLY_MORNING_OFF',        '{"choice":"no","score":null}'::jsonb,    'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'MED_DYSKINESIA_TODAY',         '{"choice":"no","score":null}'::jsonb,    'patient', now() - interval '2 days'),
    (v_patient_a, v_round_a, 'SLEEP_IMMOBILITY_AT_NIGHT',    '{"choice":"no","score":null}'::jsonb,    'patient', now() - interval '2 days');

  -- ================================================================
  -- ผู้ป่วย B — "มีจุดไม่ตรงกันชัดเจน" (5 ข้อ: motor_gait_dysfunction, gi_dysphagia,
  -- gi_constipation, sleep_insomnia, neuro_hallucination — แอปกับพยาบาลไม่ตรงกัน)
  -- ================================================================

  INSERT INTO pdlife.users (first_name, last_name, user_name, role)
  VALUES ('ทดสอบ บี', 'ครอสเช็ค', 'mock_crosscheck_patient_b', 'patient')
  RETURNING id INTO v_patient_b;

  INSERT INTO pdlife.patient_profiles
    (user_id, hn_number, gender, date_of_birth, diagnosis, diagnosis_date, hoehn_yahr_stage, wake_time, sleep_time, province)
  VALUES
    (v_patient_b, 'HN-XCHK-B', 'female', '1951-11-03', 'PD', '2015-02-10', 3, '06:00', '21:00', 'กรุงเทพมหานคร');

  INSERT INTO pdlife.appointments (patient_id, doctor_id, created_by, visit_date, visit_time, visit_type, status)
  VALUES (v_patient_b, v_doctor, v_doctor, (current_date - 1), '10:15', 'follow_up', 'completed')
  RETURNING id INTO v_appt_b;

  INSERT INTO pdlife.clinic_assessments (
    appointment_id, patient_id, nurse_id,
    motor_tremor, motor_rigidity, motor_bradykinesia, motor_gait_dysfunction,
    speech_swallowing,
    gi_drooling, gi_dysphagia, gi_constipation,
    ans_oh, ans_urinary, ans_sexual,
    sleep_insomnia, sleep_rbd, sleep_nocturia, sleep_eds,
    neuro_anxiety, neuro_depression, neuro_hallucination, neuro_dementia, neuro_icds,
    mf_wearing_off, mf_delay_on, mf_suboptimal_on, mf_early_morning_off, mf_dyskinesia, mf_nocturnal_hypokinesia,
    has_caregiver, other_note, screened_by, status, submitted_at
  ) VALUES (
    v_appt_b, v_patient_b, v_nurse,
    true, true, true, false,
    true,
    true, false, false,
    true, true, false,
    false, true, true, true,
    true, true, false, true, false,
    true, true, true, true, true, true,
    true, 'บุตรสาวพามาด้วย เล่าว่าอาการทรุดลงในช่วง 2 สัปดาห์ที่ผ่านมา', 'พยาบาลกาญจนา ดวงแก้ว', 'submitted', now() - interval '1 day'
  );

  INSERT INTO pdlife.round_instances (patient_id, template_code, appointment_id, scheduled_at, status, completed_at)
  VALUES (v_patient_b, 'PREVISIT_7D_FORM', v_appt_b, now() - interval '1 day', 'completed', now() - interval '1 day')
  RETURNING id INTO v_round_b;

  INSERT INTO pdlife.responses (patient_id, round_instance_id, question_code, answer_value, answered_by_role, answered_at) VALUES
    (v_patient_b, v_round_b, 'MOTOR_TREMOR_IMPACT',          '{"choice":"3","score":3}'::jsonb,           'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'MOTOR_WALK_BALANCE',           '{"choice":"2","score":2}'::jsonb,           'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'ADL_SPEECH_CLARITY',           '{"choice":"3","score":3}'::jsonb,           'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'ADL_DROOLING',                 '{"choice":"3","score":3}'::jsonb,           'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'ADL_SWALLOWING',                '{"choice":"3","score":3}'::jsonb,          'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'AUTO_CONSTIPATION',            '{"choice":"c2","score":null}'::jsonb,       'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'AUTO_ORTHOSTATIC_SYMPTOM',     '{"choice":"mild_repeat","score":2}'::jsonb, 'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'AUTO_URINARY_SYMPTOM',         '{"choice":"3","score":3}'::jsonb,           'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'AUTO_SEXUAL_CONCERN',          '{"choice":"no","score":null}'::jsonb,       'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'SLEEP_QUALITY',                '{"choice":"3","score":3}'::jsonb,           'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'SLEEP_RBD_OBSERVED',           '{"choice":"yes","score":null}'::jsonb,      'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'SLEEP_NOCTURIA',               '{"choice":"c5","score":null}'::jsonb,       'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'SLEEP_DAYTIME_SLEEPINESS',     '{"choice":"3","score":3}'::jsonb,           'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'MOOD_ANXIETY',                 '{"choice":"2","score":2}'::jsonb,           'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'MOOD_DEPRESSED_ANHEDONIA',     '{"choice":"1","score":1}'::jsonb,           'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'COG_HALLUCINATION',            '{"choice":"c2","score":null}'::jsonb,       'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'COG_MEMORY',                   '{"choice":"3","score":3}'::jsonb,           'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'MOOD_IMPULSE_CONTROL',         '{"choice":"no","score":null}'::jsonb,       'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'MED_WEARING_OFF',              '{"choice":"yes","score":null}'::jsonb,      'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'MED_DELAYED_OR_SUBOPTIMAL_ON', '{"choice":"c3","score":null}'::jsonb,       'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'MED_EARLY_MORNING_OFF',        '{"choice":"yes","score":null}'::jsonb,      'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'MED_DYSKINESIA_TODAY',         '{"choice":"yes","score":null}'::jsonb,      'patient', now() - interval '1 day'),
    (v_patient_b, v_round_b, 'SLEEP_IMMOBILITY_AT_NIGHT',    '{"choice":"yes","score":null}'::jsonb,      'patient', now() - interval '1 day');

  RAISE NOTICE 'สร้างข้อมูลทดสอบ cross-check เสร็จแล้ว — ผู้ป่วย A: %, ผู้ป่วย B: %', v_patient_a, v_patient_b;

END $$;
