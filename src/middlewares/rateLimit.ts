import rateLimit, { type Options } from "express-rate-limit";
import type { Request } from "express";
import { ApiError } from "../utils/ApiError";
import { env } from "../config/env";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

/**
 * Collapses a client address into the unit we actually want to meter.
 *
 * Two adjustments matter. Express reports IPv4 clients as IPv4-mapped IPv6 (`::ffff:1.2.3.4`)
 * on a dual-stack socket, so those get unwrapped to key the same as plain IPv4. And a single
 * IPv6 customer is normally handed a whole /64, so metering the full address would give an
 * attacker 2^64 fresh quotas — the prefix is the real actor.
 */
function ipKey(ip: string | undefined): string {
  if (!ip) return "unknown";
  const unmapped = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (!unmapped.includes(":")) return unmapped;
  return `${unmapped.split(":").slice(0, 4).join(":")}::`;
}

/** Answer with the same `{ error }` shape as every other failure in the API. */
const handler: Options["handler"] = (_req, _res, next) => {
  next(new ApiError(429, "Too many requests — please wait a few minutes and try again"));
};

const shared = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler,
  // ทางออกสำหรับเครื่อง dev เท่านั้น ให้ scripts/smoke.ts รันซ้ำได้โดยไม่ติดโควตาสมัครสมาชิก
  // config/env.ts จะไม่ยอมให้แอป start ถ้าเปิดค่านี้ตอน NODE_ENV=production
  skip: () => env.disableRateLimit,
} as const;

/**
 * Brute-force guard for a *specific account*.
 *
 * Keyed on address + username rather than address alone: a hospital puts every nurse behind
 * one NAT address, so metering purely by IP would let one person fat-fingering their password
 * lock out the whole ward. Successful logins are refunded, so a real user never meets this.
 */
export const loginBruteForceLimiter = rateLimit({
  ...shared,
  windowMs: FIFTEEN_MINUTES,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) =>
    `${ipKey(req.ip)}:${String((req.body as { user_name?: unknown } | undefined)?.user_name ?? "")}`,
});

/**
 * Backstop for the whole auth surface. The per-account limiter above can be sidestepped by
 * spraying different usernames, and every /login costs ~100ms of bcrypt regardless of whether
 * the account exists — cheap for the caller, expensive for us. Loose enough that shared
 * hospital egress never trips it in normal use.
 */
export const authIpLimiter = rateLimit({
  ...shared,
  windowMs: FIFTEEN_MINUTES,
  limit: 100,
  keyGenerator: (req: Request) => ipKey(req.ip),
});

/**
 * Self-signup is open to the internet — cap how fast one source can mint accounts.
 *
 * เพดานตั้งไว้กว้างกว่าที่คิดตอนแรก เพราะสถานการณ์จริงคือพยาบาลช่วยผู้ป่วยหลายคนสมัคร
 * ในคลินิกเช้าเดียวกัน ซึ่งทุกคนออกเน็ตผ่าน IP ของคลินิกเดียวกัน — เพดานที่แคบเกินไป
 * จะบล็อกการทำงานจริงก่อนจะบล็อกคนที่ตั้งใจโจมตี
 */
export const registerLimiter = rateLimit({
  ...shared,
  windowMs: ONE_HOUR,
  limit: 30,
  keyGenerator: (req: Request) => ipKey(req.ip),
});

/**
 * ค้นผู้ดูแลจากเบอร์โทร — กันการไล่เดาเบอร์ทีละหมายเลขเพื่อดูว่าใครมีบัญชีในระบบบ้าง
 *
 * วัดที่ "บัญชีผู้เรียก" ไม่ใช่ IP เพราะ endpoint นี้ต้องล็อกอินก่อนอยู่แล้ว การวัดที่ IP จะทำให้
 * ผู้ป่วยหลายคนที่อยู่หลัง NAT เดียวกันของคลินิกใช้โควตาร่วมกันทั้งที่ไม่เกี่ยวกันเลย
 *
 * เพดานตั้งพอสำหรับคนที่พิมพ์เบอร์ผิดหลายรอบในการผูกครั้งเดียว แต่ไม่พอให้กวาดเป็นชุด
 */
export const phoneLookupLimiter = rateLimit({
  ...shared,
  windowMs: FIFTEEN_MINUTES,
  limit: 20,
  keyGenerator: (req: Request) => req.user?.sub ?? ipKey(req.ip),
});

/**
 * สร้างรหัสเชิญผู้ดูแล 6 หลัก — กันสแปมสร้างรหัสรัว ๆ (แต่ละครั้งกันเลขหนึ่งตัวไว้จนหมดอายุ
 * ดู migrations/0008_add_caregiver_invites.sql)
 */
export const caregiverInviteCreateLimiter = rateLimit({
  ...shared,
  windowMs: FIFTEEN_MINUTES,
  limit: 10,
  keyGenerator: (req: Request) => req.user?.sub ?? ipKey(req.ip),
});

/**
 * ดู/ใช้รหัสเชิญ — รหัสมีแค่ 6 หลัก (900,000 ค่า) ไม่มีเพดานนี้จะไล่เดารหัสของคนอื่นจนเจอได้
 * ภายในเวลาไม่นาน วัดที่ "บัญชีผู้เรียก" ไม่ใช่ IP เพราะต้องล็อกอินก่อนอยู่แล้ว
 */
export const caregiverInviteLookupLimiter = rateLimit({
  ...shared,
  windowMs: FIFTEEN_MINUTES,
  limit: 20,
  keyGenerator: (req: Request) => req.user?.sub ?? ipKey(req.ip),
});

/**
 * ค้น/ผูกผู้ป่วยด้วยเลขบัตรประชาชน/HN (caregiverService.ts::linkPatientByIdentifier) — เพดานแคบ
 * กว่า caregiverInviteLookupLimiter ตั้งใจ เพราะเลขบัตร/HN ไม่ใช่ secret สุ่ม 6 หลักที่ออกมาเพื่อ
 * จุดประสงค์นี้โดยเฉพาะ (HN เป็นเลขรัน เดาช่วงได้ง่ายกว่า) วัดที่ "บัญชีผู้เรียก" เพราะ endpoint
 * ต้องล็อกอินด้วย role=caregiver อยู่แล้ว — เป็นด่านกันเดาสุ่มด่านเดียวที่มีตอนนี้ ไม่ใช่การป้องกัน
 * ที่สมบูรณ์ (ดูคอมเมนต์เต็มที่ linkPatientByIdentifier)
 */
export const searchPatientLimiter = rateLimit({
  ...shared,
  windowMs: FIFTEEN_MINUTES,
  limit: 8,
  keyGenerator: (req: Request) => req.user?.sub ?? ipKey(req.ip),
});
