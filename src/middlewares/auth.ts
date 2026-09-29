import { verifyToken } from "../utils/jwt";
import { isSupabaseToken, verifySupabaseToken } from "../utils/supabaseJwt";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/asyncHandler";
import { findUserByAuthUid, findUserById } from "../repositories/userRepository";
import type { UserRow } from "../types/database";

/**
 * รับ token ได้สองแบบระหว่างช่วงเปลี่ยนผ่านไป Supabase Auth
 *
 *   - token ของ Supabase  → ตรวจด้วยกุญแจสาธารณะ (JWKS) แล้วค้นผู้ใช้ด้วย auth_uid
 *   - token ที่เราออกเอง   → ตรวจแบบเดิม แล้วค้นด้วย id
 *
 * ที่ต้องรับสองแบบเพราะเว็บ staff กับแอปมือถือย้ายคนละเวลา ถ้าตัดของเก่าทิ้งทันทีระบบที่ใช้งาน
 * อยู่จะพังกลางทาง — จะตัดทิ้งเมื่อทุก client ย้ายครบแล้ว
 *
 * ไม่ว่าจะมาทางไหน หลังจากนี้เหมือนกันหมด: อ่านแถวผู้ใช้จากฐานข้อมูลทุก request เพื่อให้การ
 * ปิดบัญชีหรือลดสิทธิ์มีผลทันที ไม่ต้องรอ token หมดอายุ ต้นทุนคือการค้นด้วย primary key
 * หนึ่งครั้ง ซึ่งคุ้มเพราะ middleware ตัวนี้เป็นด่านเดียวที่กันข้อมูลผู้ป่วย (RLS ยังไม่เปิด)
 */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(new ApiError(401, "Missing or malformed Authorization header"));
  }

  // อ่าน iss เพื่อเลือกเส้นทางตรวจเท่านั้น ไม่ใช่การอนุญาต — ทั้งสองเส้นทาง verify ลายเซ็นเต็มรูปแบบ
  const viaSupabase = isSupabaseToken(token);

  let user: UserRow | null;
  if (viaSupabase) {
    // ApiError 401 จากตัว verify จะไหลออกไปเอง ส่วน error อื่น (เช่นดึง JWKS ไม่ได้) เป็น 500
    const { authUid } = await verifySupabaseToken(token);
    user = await findUserByAuthUid(authUid);
  } else {
    let sub: string;
    try {
      sub = verifyToken(token).sub;
    } catch {
      return next(new ApiError(401, "Invalid or expired token"));
    }
    // ฐานข้อมูลล่มต้องเป็น 500 ไม่ใช่ 401 — ตอบ 401 จะไล่ผู้ใช้ไปหน้า login ที่แก้อะไรไม่ได้
    // และซ่อนเหตุขัดข้องจริงจากคนที่ต้องเข้ามาแก้
    user = await findUserById(sub);
  }

  if (!user) {
    // ข้อความเดียวกับ token ผิดโดยตั้งใจ ไม่งั้นคนที่ถือ token ที่ถูกต้องจะไล่หาได้ว่า id ไหนมีจริง
    // ครอบคลุมกรณีที่มีบัญชีใน Supabase แล้วแต่ยังไม่มีโปรไฟล์ใน PDLIFE ด้วย
    return next(new ApiError(401, "Invalid or expired token"));
  }
  if (!user.is_active) {
    return next(new ApiError(403, "This account has been deactivated"));
  }

  // role มาจากแถวในฐานข้อมูลเสมอ ไม่ใช่จาก token — การลดสิทธิ์จึงมีผลกับ request ถัดไปทันที
  req.user = { sub: user.id, role: user.role };
  next();
});
