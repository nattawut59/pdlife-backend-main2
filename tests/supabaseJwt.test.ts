import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { isSupabaseToken, verifySupabaseToken } from "../src/utils/supabaseJwt";
import { signToken } from "../src/utils/jwt";
import { ApiError } from "../src/utils/ApiError";

/**
 * เทสต์ชุดนี้รันโดยไม่มี Supabase จริง (.env.test ชี้ไป localhost:0) จึงยืนยันได้เฉพาะส่วนที่
 * ตัดสินใจได้ก่อนต้องใช้กุญแจ — คือการเลือกเส้นทางตรวจ และการปฏิเสธ token ที่ผิดรูปตั้งแต่ต้น
 * ส่วนการ verify ด้วยกุญแจจริงทดสอบใน scripts/smoke.ts ซึ่งยิงกับ Supabase ของจริง
 */

const SUPABASE_ISSUER = `${process.env.SUPABASE_URL}/auth/v1`;

test("isSupabaseToken: แยก token ของ Supabase ออกจาก token ที่เราออกเอง", () => {
  const ours = signToken({ sub: "11111111-1111-1111-1111-111111111111", role: "doctor" });
  assert.equal(isSupabaseToken(ours), false, "token ของเราต้องไม่ถูกส่งไปตรวจแบบ Supabase");

  const theirs = jwt.sign({ sub: "abc" }, "irrelevant", {
    issuer: SUPABASE_ISSUER,
    audience: "authenticated",
  });
  assert.equal(isSupabaseToken(theirs), true);
});

test("isSupabaseToken: iss ของบริการอื่นต้องไม่ถูกนับเป็น Supabase", () => {
  // จุดสำคัญ: คนร้ายตั้ง iss เองได้ แต่การเลือกเส้นทางไม่ใช่การอนุญาต —
  // ไม่ว่าจะไปทางไหนก็ต้องผ่านการ verify ลายเซ็นเต็มรูปแบบอยู่ดี
  const spoofed = jwt.sign({ sub: "abc" }, "irrelevant", {
    issuer: "https://evil.supabase.co/auth/v1",
    audience: "authenticated",
  });
  assert.equal(isSupabaseToken(spoofed), false);
});

test("isSupabaseToken: ข้อความที่ไม่ใช่ JWT ต้องไม่ทำให้พัง", () => {
  assert.equal(isSupabaseToken("not-a-token"), false);
  assert.equal(isSupabaseToken(""), false);
});

test("verifySupabaseToken: token ที่ไม่มี kid ถูกปฏิเสธก่อนไปแตะ JWKS", () => {
  // ไม่มี kid = ระบุไม่ได้ว่าใช้กุญแจดอกไหน ปฏิเสธตั้งแต่ต้นดีกว่าปล่อยให้ไปยิง network
  const noKid = jwt.sign({ sub: "abc" }, "irrelevant", { issuer: SUPABASE_ISSUER });
  return assert.rejects(
    () => verifySupabaseToken(noKid),
    (err: unknown) => err instanceof ApiError && err.statusCode === 401
  );
});
