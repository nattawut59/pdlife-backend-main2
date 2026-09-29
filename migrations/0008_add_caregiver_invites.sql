-- =====================================================================
-- 0008_add_caregiver_invites.sql
--
-- ระบบ "รหัสเชิญ 6 หลัก" ให้ผู้ดูแลใหม่พิมพ์รหัสแล้วเข้าร่วมดูแลผู้ป่วยได้ทันที
-- (ดีไซน์ที่ผู้ใช้ยืนยัน 2569-09) แทนที่แนวคิด QR + รออนุมัติจาก Admin ที่เคยร่างไว้
-- ฝั่ง frontend (src/api/caregiverLink.ts เดิม) แต่ไม่เคยมี endpoint จริงฝั่งนี้เลย
--
-- รันในโปรเจกต์ทดสอบ (oibjuxjiaftkcdhxyvuh) เท่านั้น — ห้ามรันกับโปรเจกต์จริง
--
-- ทำไม "redeemed_at IS NULL" เป็นตัวกันซ้ำ ไม่ใช่ UNIQUE(code) เฉยๆ
-- --------------------------------------------------------------------
-- รหัสมีแค่ 6 หลัก (900,000 ค่าที่เป็นไปได้) ถ้า UNIQUE ทั้งตารางตรงๆ รหัสจะถูกใช้ซ้ำไม่ได้
-- อีกเลยตลอดชีพของระบบ ไม่นานก็ชนกันหมด — unique index บางส่วน (partial) ด้านล่างกันแค่ไม่ให้
-- มี "รหัสที่ยังไม่ถูกใช้" ซ้ำกันสองแถวพร้อมกัน ส่วนรหัสที่ redeem ไปแล้วนำเลขเดิมกลับมาออกใหม่ได้
-- (รหัสที่หมดอายุแต่ยังไม่ถูก redeem จะยังกันเลขนั้นไว้ต่อ — ยอมรับได้สำหรับสเกลของแอปนี้
-- ถ้าต้องการนำเลขกลับมาใช้เร็วขึ้นในอนาคตค่อยทำ cleanup job ลบแถวหมดอายุทีหลัง)
-- =====================================================================

BEGIN;

CREATE TABLE pdlife.caregiver_invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   UUID NOT NULL REFERENCES pdlife.users(id) ON DELETE CASCADE,
  code         VARCHAR(6) NOT NULL,             -- เลข 6 หลัก เช่น "042981"
  created_by   UUID NOT NULL REFERENCES pdlife.users(id),  -- ผู้ป่วยเอง หรือผู้ดูแลที่ผูกอยู่แล้ว
  expires_at   TIMESTAMPTZ NOT NULL,
  redeemed_at  TIMESTAMPTZ,
  redeemed_by  UUID REFERENCES pdlife.users(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- กันรหัสที่ "ยังใช้งานอยู่" (ยังไม่ redeem) ซ้ำกันสองแถวพร้อมกันเท่านั้น — ดูเหตุผลด้านบนไฟล์
CREATE UNIQUE INDEX idx_caregiver_invites_active_code
  ON pdlife.caregiver_invites (code)
  WHERE redeemed_at IS NULL;

-- ค้นหารหัสที่ผู้ป่วยรายหนึ่งเคยสร้าง (ยังไม่ต้องใช้ตอนนี้ แต่เตรียมไว้เผื่อทำหน้า "ประวัติการเชิญ")
CREATE INDEX idx_caregiver_invites_patient ON pdlife.caregiver_invites (patient_id);

-- ไม่ต้อง GRANT เพิ่ม — 0002_grant_service_role.sql ตั้ง ALTER DEFAULT PRIVILEGES ไว้แล้ว
-- ตารางใหม่ทุกตัวที่สร้างโดย role เดียวกับที่รัน 0002 จะได้สิทธิ์ service_role อัตโนมัติ

COMMIT;

-- ตรวจว่าสำเร็จ
-- SELECT * FROM pdlife.caregiver_invites LIMIT 1;
