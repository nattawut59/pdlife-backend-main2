import dotenv from "dotenv";
import { z } from "zod";

// ตอนรันเทสต์จะไม่อ่าน .env ของเครื่องเลย ค่ามาจาก --env-file=.env.test อย่างเดียว
//
// เหตุผลด้านความปลอดภัย: ถ้าอ่าน .env ตามปกติ เครื่องที่ตั้ง .env ชี้ไปยัง Supabase ที่มีข้อมูล
// ผู้ป่วยจริง แล้วเผลอรัน npm test เทสต์จะยิงเข้าฐานข้อมูลนั้น — และเทสต์ของเรามีทั้งอ่านและเขียน
// เหตุผลด้านความถูกต้อง: ผลเทสต์จะได้เหมือนกันทุกเครื่องและบน CI ไม่ขึ้นกับ .env ของใครคนหนึ่ง
if (process.env.NODE_ENV !== "test") dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  JWT_EXPIRES_IN: z.string().default("1d"),
  // Comma-separated list — a native mobile app (Expo/React Native) never sends an Origin
  // header the browser CORS check cares about, so this only matters for browser-based
  // clients (the web dashboard). "*" allows any origin (fine for local dev, not for prod).
  CORS_ORIGIN: z.string().default("*"),
  // How many reverse proxies sit in front of this app (0 = none, talking straight to clients).
  // Express needs this to pick the real client address out of X-Forwarded-For, and the rate
  // limiters meter on that address. Too low and every request looks like it came from the
  // proxy, so one caller exhausts everyone's quota; too high and a client can prepend a fake
  // X-Forwarded-For entry to get a fresh quota on demand.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  // ปิด rate limit ทั้งหมด — มีไว้ให้ scripts/smoke.ts รันซ้ำได้โดยไม่ติดโควตาสมัครสมาชิก
  // รับเฉพาะค่า "true" ตรงตัว และการตั้งค่านี้บน production จะทำให้แอปไม่ยอม start (ดูด้านล่าง)
  DISABLE_RATE_LIMIT: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

// Placeholder values that ship in .env.example and tutorials — a secret anyone can guess is
// the same as no secret at all, since JWT_SECRET is the *only* thing stopping a forged
// `{ role: "admin" }` token from being accepted.
const PLACEHOLDER_SECRET = /^(change|secret|test|password|your[-_ ]?secret)/i;

// HS256 is HMAC-SHA256, so the key should be at least as long as the hash it feeds
// (256 bits = 32 bytes) — RFC 7518 §3.2. Shorter keys cap the strength below the algorithm's.
const MIN_SECRET_LENGTH = 32;

// Report every problem at once rather than failing on the first — whoever fixes this should
// only need one restart. Never echo the secret itself; logs get shipped off-box.
const problems: string[] = [];

if (parsed.data.JWT_SECRET.length < MIN_SECRET_LENGTH) {
  problems.push(
    `JWT_SECRET is too short (${parsed.data.JWT_SECRET.length} chars, need >= ${MIN_SECRET_LENGTH}) ` +
      `— generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
  );
}
if (PLACEHOLDER_SECRET.test(parsed.data.JWT_SECRET)) {
  problems.push("JWT_SECRET looks like a placeholder value — replace it with a random secret");
}
if (parsed.data.CORS_ORIGIN === "*") {
  problems.push('CORS_ORIGIN must not be "*" — list the real client origins instead');
}
if (parsed.data.DISABLE_RATE_LIMIT) {
  // เตือนทุกครั้งที่ start บนเครื่อง dev ด้วย ไม่ใช่แค่บล็อกบน production — เพื่อไม่ให้ลืมว่า
  // ตอนนี้ /login เปิดให้เดารหัสผ่านได้ไม่จำกัด
  problems.push("DISABLE_RATE_LIMIT is on — /login has no brute-force guard right now");
}

if (problems.length > 0) {
  if (parsed.data.NODE_ENV === "production") {
    // Fail closed: refusing to boot is safer than serving patient data behind a guessable key.
    console.error("Refusing to start with an unsafe configuration:", problems);
    throw new Error("Unsafe environment configuration");
  }
  // Outside production this is a warning only, so `npm test` can run with dummy values.
  console.warn("[env] unsafe configuration (allowed outside production):", problems);
}

export const env = {
  nodeEnv: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  supabaseUrl: parsed.data.SUPABASE_URL,
  supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
  jwtSecret: parsed.data.JWT_SECRET,
  jwtExpiresIn: parsed.data.JWT_EXPIRES_IN,
  corsOrigin: parsed.data.CORS_ORIGIN === "*" ? "*" : parsed.data.CORS_ORIGIN.split(",").map((s) => s.trim()),
  // Express treats 0 as "trust nothing"; keep that explicit as `false` so the intent reads.
  trustProxy: parsed.data.TRUST_PROXY === 0 ? false : parsed.data.TRUST_PROXY,
  disableRateLimit: parsed.data.DISABLE_RATE_LIMIT,
};
