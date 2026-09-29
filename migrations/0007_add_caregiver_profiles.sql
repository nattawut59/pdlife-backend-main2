-- =====================================================================
-- 0007_add_caregiver_profiles.sql
--
-- ฟอร์มสมัครสมาชิกผู้ดูแล (ทีมงานยืนยันแล้ว 2569-09) ต้องเก็บคำนำหน้า/เพศ/วันเกิด/
-- ความสัมพันธ์/ที่อยู่แบบละเอียด เพิ่มจากที่ `pdlife.users` เก็บอยู่ตอนนี้ (ชื่อ-นามสกุล-เบอร์
-- เท่านั้น) — แยกเป็นตารางใหม่ 1:1 กับ users แบบเดียวกับ patient_profiles เพื่อไม่ให้กระทบ
-- role อื่น (patient/nurse/doctor/admin ไม่มี field พวกนี้)
--
-- รันในโปรเจกต์ทดสอบ (oibjuxjiaftkcdhxyvuh) เท่านั้น — ห้ามรันกับโปรเจกต์จริง
--
-- หมายเหตุสำคัญ: คอลัมน์ `relationship` ในตารางนี้ "ไม่ใช่" ตัวเดียวกับ
-- `patient_caregivers.relationship` ที่มีอยู่แล้ว — ตัวนั้นผูกกับผู้ป่วยแต่ละคนแยกกัน (ผู้ดูแล
-- 1 คนอาจดูแลผู้ป่วยหลายคนด้วยความสัมพันธ์ต่างกัน เช่น เป็นลูกของคนหนึ่ง เป็นเพื่อนบ้านอีกคน)
-- ส่วนคอลัมน์นี้คือค่าที่กรอกตอนสมัครสมาชิกครั้งเดียว ใช้เป็นข้อมูลทั่วไปของผู้ดูแลเอง
--
-- ON DELETE CASCADE เหมือน patient_profiles — ลบ users row แล้วโปรไฟล์นี้หายไปด้วยอัตโนมัติ
-- (ใช้ตอน rollback ถ้าสมัครสมาชิกล้มเหลวครึ่งทาง ดู authService.register)
-- =====================================================================

BEGIN;

CREATE TABLE pdlife.caregiver_profiles (
  user_id        UUID PRIMARY KEY REFERENCES pdlife.users(id) ON DELETE CASCADE,
  prefix         VARCHAR NOT NULL,       -- คำนำหน้า เช่น นาย/นาง/นางสาว
  gender         pdlife.gender_type NOT NULL,
  date_of_birth  DATE NOT NULL,
  relationship   VARCHAR NOT NULL,       -- ความสัมพันธ์ทั่วไปกับผู้ป่วย (ค่าเริ่มต้น ไม่ผูกกับผู้ป่วยรายใดรายหนึ่ง)
  address_line   VARCHAR NOT NULL,       -- บ้านเลขที่ / ถนน
  subdistrict    VARCHAR NOT NULL,       -- ตำบล/แขวง
  district       VARCHAR NOT NULL,       -- อำเภอ/เขต
  province       VARCHAR NOT NULL,
  postal_code    VARCHAR NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- ไม่ต้อง GRANT เพิ่ม — 0002_grant_service_role.sql ตั้ง ALTER DEFAULT PRIVILEGES ไว้แล้ว
-- ตารางใหม่ทุกตัวที่สร้างโดย role เดียวกับที่รัน 0002 จะได้สิทธิ์ service_role อัตโนมัติ

COMMIT;

-- ตรวจว่าสำเร็จ
-- SELECT * FROM pdlife.caregiver_profiles LIMIT 1;
