import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * Uses the service-role key: this client bypasses RLS entirely. Every authorization
 * decision therefore happens in the app (see src/services/patientAccessService.ts) — RLS is
 * explicitly not enabled yet (schema v3.3 §11, dev phase), and that section's own guidance is
 * "have the app call through a backend that holds the service key only," which is exactly
 * this architecture.
 *
 * All tables live in the `pdlife` Postgres schema, not `public` (schema v3.2+) — `pdlife` must
 * be added to Supabase's exposed schemas list (Project Settings -> API -> Exposed schemas) or
 * every request below will 404. Setting db.schema here means every repository's `.from(...)`
 * call resolves against `pdlife.*` without needing to change per-call.
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: "pdlife" },
});

/**
 * client แยกต่างหาก ใช้เฉพาะตอนต้องเรียก `auth.signInWithPassword()` (ยืนยันรหัสผ่าน
 * ผ่าน Supabase Auth ใน authService.ts::login())
 *
 * ⚠️ ห้ามเรียก signInWithPassword() (หรือ signUp/verifyOtp/refreshSession — auth flow
 * ไหนก็ตามที่ "ล็อกอิน" client) บน `supabase` singleton ด้านบนเด็ดขาด แม้จะตั้ง
 * persistSession: false ไว้แล้วก็ตาม — persistSession คุมแค่ "ไม่เขียนลง storage"
 * เท่านั้น ตัว client ยังจำ session ที่เพิ่งล็อกอินสำเร็จไว้ใน memory ของตัวเองอยู่ดี
 * แล้ว .from(...) ครั้งถัดไปบน client ตัวเดียวกัน (ของ request อื่นด้วย เพราะ
 * `supabase` เป็น module-level singleton ใช้ร่วมกันทั้งโปรเซส) จะเปลี่ยนไปใช้สิทธิ์
 * "authenticated" ของ user คนที่เพิ่งล็อกอินแทน service_role โดยไม่มีใครรู้ตัว —
 * authenticated ยังไม่ได้ grant สิทธิ์บน schema pdlife เลย (migrations/
 * 0002_grant_service_role.sql grant ให้แค่ service_role) เลยพัง
 * "permission denied for schema pdlife" (42501) ทันทีที่ query ถัดไปมาถึง — เจอบั๊กนี้
 * จริงตอน login() เรียก touchLastLogin() ต่อจาก signInWithPassword() ที่เผลอไปเรียก
 * บน singleton เดิม
 *
 * สร้างใหม่ทุกครั้งที่เรียกฟังก์ชันนี้ (ไม่แชร์ instance กับใคร ไม่ export เป็น
 * singleton) ตัดทางที่จะไปปนกับ `supabase` ด้านบนหรือ request อื่นได้เลย
 */
export function createAuthVerifierClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
