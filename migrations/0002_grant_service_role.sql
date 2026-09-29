-- =====================================================================
-- 0002 — ให้สิทธิ์ service_role บน schema pdlife
-- =====================================================================
--
-- ทำไมต้องมีไฟล์นี้
-- ----------------
-- Supabase มี Postgres role ในตัว 3 ตัว: anon (ยังไม่ login), authenticated (login แล้ว),
-- และ service_role (backend ที่ถือ secret key) — backend ของเราทำงานเป็น service_role
--
-- 0001_init_schema.sql §12 สร้าง role ชื่อ pdlife_app ขึ้นมาเองแล้ว grant ให้ role นั้น
-- แต่ไม่ได้ grant ให้ role ของ Supabase เลย ผลคือ backend เรียก API แล้วได้
--
--     42501  permission denied for schema pdlife
--
-- ต้องรันไฟล์นี้ "หลัง" 0001 และ "ก่อน" seed/seed.sql
-- (การเพิ่ม pdlife ใน Settings → API → Exposed schemas เป็นคนละเรื่อง ต้องทำด้วยเช่นกัน)
--
--
-- ทำไมไม่ grant ให้ anon กับ authenticated ด้วย
-- --------------------------------------------
-- คำแนะนำทั่วไปบนอินเทอร์เน็ตมักให้ grant ทั้งสาม role รวดเดียว — อย่าทำที่นี่
--
-- anon คือสิทธิ์ของผู้ถือ publishable key ซึ่งเป็น key ที่จะฝังอยู่ในแอปมือถือ และตอนนี้
-- RLS ยังไม่เปิด (schema §11) แปลว่าถ้า grant ให้ anon ใครก็ตามที่ดึง key ออกจากแอปได้
-- จะอ่านข้อมูลผู้ป่วยได้ทุกแถวทันที ตรงกับที่ §11 เตือนไว้เองว่า
--   "ให้แอปเรียกผ่าน backend ที่ถือ service key เท่านั้น อย่าเปิด anon key ให้ client"
--
-- ค่อยเพิ่ม authenticated ตอนเปิด RLS พร้อม policy ครบแล้ว ไม่ใช่ตอนนี้
-- =====================================================================

BEGIN;

-- มองเห็น schema ได้ (ยังไม่รวมสิทธิ์อ่าน/เขียนตาราง)
GRANT USAGE ON SCHEMA pdlife TO service_role;

-- อ่าน/เขียนตารางและ view ทั้งหมดที่มีอยู่ตอนนี้
GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA pdlife TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA pdlife TO service_role;

-- ตารางที่ถูกสร้างเพิ่มในอนาคตจะได้สิทธิ์เองอัตโนมัติ ไม่ต้องกลับมารัน grant ซ้ำทุกครั้ง
-- ที่มี migration ใหม่ (มีผลกับ object ที่สร้างโดย role ที่รันไฟล์นี้เท่านั้น)
ALTER DEFAULT PRIVILEGES IN SCHEMA pdlife GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pdlife GRANT ALL ON SEQUENCES TO service_role;

COMMIT;

-- ตรวจว่าสำเร็จ — ควรได้ true
-- SELECT has_schema_privilege('service_role', 'pdlife', 'USAGE')
--    AND has_table_privilege('service_role', 'pdlife.users', 'SELECT') AS ok;
