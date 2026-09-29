-- =====================================================================
-- 0006_add_id_card_to_patient_full_view.sql
--
-- ทะเบียนผู้ป่วยฝั่งเว็บ (แท็บ "ผู้ป่วยในคลินิก") กำลังเปลี่ยนจากข้อมูลจำลองมาใช้
-- GET /dashboard/roster ของจริง ซึ่งอ่านจาก view นี้ — ต้องมีเลขบัตรประชาชนโชว์ในตาราง/
-- โปรไฟล์ย่อ แต่ v_patient_full เดิมไม่ได้ select id_card_number ออกมาทั้งที่มีอยู่แล้วใน
-- patient_profiles จึงแค่ CREATE OR REPLACE เพิ่มคอลัมน์เดียว ไม่แตะโครงสร้างตารางใดๆ
--
-- รันทั้งไฟล์ในโปรเจกต์ทดสอบ (oibjuxjiaftkcdhxyvuh) เท่านั้น — ห้ามรันกับโปรเจกต์จริง
--
-- !! คอลัมน์ใหม่ (id_card_number) ต้องอยู่ท้ายรายการเท่านั้น — CREATE OR REPLACE VIEW ของ
--    Postgres ยอมให้ "เพิ่มคอลัมน์ท้ายรายการ" อย่างเดียว ถ้าแทรกกลาง/เปลี่ยนลำดับคอลัมน์เดิม
--    จะ error ทันที (เจอเองตอนตรวจทานไฟล์นี้ก่อนรัน จึงย้ายมาไว้ท้ายสุดแทนที่จะแทรกหลัง
--    phone_number ตามที่ร่างไว้รอบแรก)
-- =====================================================================

CREATE OR REPLACE VIEW pdlife.v_patient_full
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
    WHERE pc.patient_id = u.id AND pc.active) AS caregiver_count,
  p.id_card_number
FROM pdlife.users u
JOIN pdlife.patient_profiles p ON p.user_id = u.id
WHERE u.is_active;
