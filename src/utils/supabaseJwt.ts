import { createPublicKey, type KeyObject } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { ApiError } from "./ApiError";

/**
 * ตรวจ token ที่ออกโดย Supabase Auth ด้วยกุญแจสาธารณะจาก JWKS
 *
 * Supabase เซ็นด้วยกุญแจอสมมาตร (ES256) และเปิดกุญแจสาธารณะไว้ที่ JWKS endpoint — เราจึงตรวจเอง
 * ในเครื่องได้โดยไม่ต้องยิงถาม Supabase ทุก request Node แปลง JWK เป็น public key ได้เองผ่าน
 * crypto.createPublicKey จึงไม่ต้องพึ่งไลบรารีเพิ่ม
 *
 * ข้อแลกเปลี่ยนของการตรวจเองคือ token ที่ถูกยกเลิกฝั่ง Supabase จะยังใช้ได้จนหมดอายุ —
 * รับได้เพราะ requireAuth อ่าน is_active จากฐานข้อมูลเราทุก request อยู่แล้ว ซึ่งเป็นสวิตช์
 * ตัดสิทธิ์ที่มีผลทันทีและเป็นสวิตช์ที่ระบบเราควรใช้จริง
 */

const ISSUER = `${env.supabaseUrl}/auth/v1`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;

// Supabase ใส่ aud = "authenticated" ให้ผู้ใช้ที่ล็อกอินแล้วทุกคน
const AUDIENCE = "authenticated";

// pin ไว้เฉพาะอัลกอริทึมอสมมาตร ไม่ปล่อยให้ header ของ token เลือกวิธีตรวจตัวเอง
const ALGORITHMS: jwt.Algorithm[] = ["ES256", "RS256"];

// กันไม่ให้ token ที่ใส่ kid มั่วๆ มาบังคับให้เรายิงขอ JWKS รัวๆ จนกลายเป็นช่องทาง DoS
const REFRESH_COOLDOWN_MS = 60_000;

let cachedKeys: Map<string, KeyObject> | null = null;
let lastFetchedAt = 0;
let inflight: Promise<Map<string, KeyObject>> | null = null;

async function fetchKeys(): Promise<Map<string, KeyObject>> {
  const res = await fetch(JWKS_URL);
  if (!res.ok) {
    // ดึงกุญแจไม่ได้คือปัญหาฝั่งเรา ไม่ใช่ผู้เรียกผิด — ปล่อยเป็น 500 อย่าตอบ 401
    throw new Error(`Could not fetch Supabase JWKS (${res.status})`);
  }
  const body = (await res.json()) as { keys?: unknown[] };
  const map = new Map<string, KeyObject>();
  for (const jwk of body.keys ?? []) {
    const kid = (jwk as { kid?: string }).kid;
    if (!kid) continue;
    try {
      map.set(kid, createPublicKey({ key: jwk as never, format: "jwk" }));
    } catch {
      // กุญแจดอกที่แปลงไม่ได้ให้ข้ามไป ดอกอื่นยังใช้ได้
    }
  }
  if (map.size === 0) throw new Error("Supabase JWKS returned no usable keys");

  cachedKeys = map;
  lastFetchedAt = Date.now();
  return map;
}

/** ใช้กุญแจที่แคชไว้ ถ้ายังไม่มีหรือถูกสั่งให้รีเฟรชก็ไปดึงใหม่ (คำขอที่ซ้อนกันใช้ผลเดียวกัน) */
async function getKeys(forceRefresh = false): Promise<Map<string, KeyObject>> {
  const stale = forceRefresh && Date.now() - lastFetchedAt > REFRESH_COOLDOWN_MS;
  if (cachedKeys && !stale) return cachedKeys;
  if (!inflight) {
    inflight = fetchKeys().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/**
 * ดู iss เพื่อเลือกว่าจะตรวจด้วยวิธีไหน — ยังไม่ verify ตรงนี้
 * ปลอดภัยเพราะไม่ว่าจะเลือกทางไหน ก็ต้องผ่านการ verify เต็มรูปแบบเสมอหลังจากนี้
 */
export function isSupabaseToken(token: string): boolean {
  const decoded = jwt.decode(token);
  return typeof decoded === "object" && decoded !== null && (decoded as { iss?: unknown }).iss === ISSUER;
}

/** คืน auth.users.id ของผู้ใช้ที่ token นี้เป็นตัวแทน — โยน ApiError 401 ถ้า token ใช้ไม่ได้ */
export async function verifySupabaseToken(token: string): Promise<{ authUid: string }> {
  const kid = jwt.decode(token, { complete: true })?.header?.kid;
  if (!kid) throw new ApiError(401, "Invalid or expired token");

  let key = (await getKeys()).get(kid);
  if (!key) {
    // ไม่รู้จัก kid นี้ — Supabase อาจเพิ่งหมุนกุญแจ ลองดึงใหม่หนึ่งครั้ง
    key = (await getKeys(true)).get(kid);
  }
  if (!key) throw new ApiError(401, "Invalid or expired token");

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, key, {
      algorithms: ALGORITHMS,
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as jwt.JwtPayload;
  } catch {
    throw new ApiError(401, "Invalid or expired token");
  }

  if (!payload.sub) throw new ApiError(401, "Invalid or expired token");
  return { authUid: String(payload.sub) };
}
