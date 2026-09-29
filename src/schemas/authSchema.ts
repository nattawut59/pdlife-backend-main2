import { z } from "zod";
import { GENDER_TYPES, LANG_CODES, USER_ROLES } from "../config/constants";

/**
 * bcrypt silently ignores everything past 72 *bytes* — and Thai is 3 bytes per character in
 * UTF-8, so a 30-character Thai password would be cut down to its first 24. Two different
 * passwords sharing that prefix would then open the same account, with nothing to warn either
 * the user or us. Reject over-long input instead of truncating it. Counting characters with
 * `.max()` would not catch this: 72 Thai characters is 216 bytes.
 *
 * ยังบังคับเพดานนี้อยู่แม้รหัสผ่านจะถูกเก็บที่ Supabase แล้ว เพื่อให้ข้อความ error สอดคล้องกัน
 * ไม่ว่าบัญชีจะถูกสร้างทางไหน
 */
const BCRYPT_MAX_BYTES = 72;

const passwordField = z
  .string()
  .min(8)
  .refine((value) => Buffer.byteLength(value, "utf8") <= BCRYPT_MAX_BYTES, {
    message: `Password must not exceed ${BCRYPT_MAX_BYTES} bytes (about 24 Thai or 72 Latin characters)`,
  });

/**
 * เบอร์โทรคือตัวระบุตัวตนที่ใช้ล็อกอิน — Supabase Auth รับเฉพาะรูปแบบสากล (E.164) เท่านั้น
 *
 * แปลงให้อัตโนมัติเพราะผู้ป่วยสูงอายุไม่ควรต้องรู้จักคำว่า "+66" — เขาพิมพ์เบอร์แบบที่ใช้
 * ในชีวิตประจำวัน (081-234-5678) แล้วระบบจัดการเอง เว้นวรรคและขีดถูกตัดทิ้งก่อนตรวจ
 */
export const phoneField = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .refine((value) => /^(0\d{8,9}|\+66\d{8,9})$/.test(value), {
    message: "Phone number must be a Thai number, e.g. 0812345678 or +66812345678",
  })
  .transform((value) => (value.startsWith("0") ? `+66${value.slice(1)}` : value));

/**
 * ฟิลด์ร่วมของทุก role ที่สมัคร/ถูกสร้างบัญชี — แยกออกมาจาก registerSchema เพราะ registerSchema
 * ต้องผ่าน .superRefine() ด้านล่าง (ทำให้ .extend() ต่อไม่ได้) แต่ provisionSchema ยังต้อง
 * extend ฟิลด์ร่วมชุดนี้อยู่
 */
const baseRegisterFields = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  password: passwordField,
  phone_number: phoneField,
  user_name: z.string().min(3).max(50).optional(),
  preferred_language: z.enum(LANG_CODES).optional(),
});

/**
 * ที่อยู่แบบละเอียด — แยกฟิลด์ย่อยแทนช่องเดียว เพื่อให้ค้นหา/ออกรายงานตามพื้นที่ได้ทีหลัง
 * (ตัดสินใจร่วมกับผู้ใช้ 2569-09 ตอนออกแบบฟอร์มสมัครผู้ดูแล)
 */
const caregiverAddressFields = {
  address_line: z.string().min(1),
  subdistrict: z.string().min(1),
  district: z.string().min(1),
  province: z.string().min(1),
  postal_code: z.string().regex(/^\d{5}$/, "Postal code must be 5 digits"),
};

/**
 * ฟิลด์เฉพาะผู้ดูแล — ใส่เป็น optional ในตัว object แล้วบังคับด้วย .superRefine() ด้านล่าง
 * แทนการทำ discriminated union เพราะ provisionSchema (ทางฝั่ง admin) ยังต้อง .extend()
 * จาก baseRegisterFields ตัวเดียวกันได้อยู่ โดยไม่ต้องรู้จักฟิลด์ชุดนี้เลย
 *
 * `relationship` ที่นี่เป็นค่าเริ่มต้นตอนสมัคร คนละตัวกับ patient_caregivers.relationship
 * ที่กรอกตอนผูกกับผู้ป่วยแต่ละคน (ผู้ดูแล 1 คนอาจดูแลผู้ป่วยหลายคนด้วยความสัมพันธ์ต่างกัน)
 */
const caregiverProfileFields = {
  prefix: z.string().min(1),
  gender: z.enum(GENDER_TYPES),
  date_of_birth: z.string().date(),
  relationship: z.string().min(1),
  ...caregiverAddressFields,
};

/**
 * Public self-registration is limited to patient/caregiver — staff roles require /auth/provision.
 *
 * ไม่ต้องส่ง `user_name` มา — ระบบตั้งให้เท่ากับเบอร์โทรโดยอัตโนมัติ เพราะหลังย้ายไป Supabase Auth
 * แล้วเบอร์คือตัวที่ใช้ล็อกอินจริง ส่วน user_name เหลือไว้เพราะ schema บังคับ NOT NULL UNIQUE —
 * การให้ผู้ป่วยคิดชื่อผู้ใช้เพิ่มอีกช่องคือการเพิ่มสิ่งที่ต้องจำโดยไม่ได้ใช้ทำอะไร
 *
 * role=caregiver ต้องกรอกฟิลด์โปรไฟล์เพิ่ม (คำนำหน้า/เพศ/วันเกิด/ความสัมพันธ์/ที่อยู่) —
 * role=patient ไม่ต้อง เพราะฟอร์มโปรไฟล์ผู้ป่วยเป็นคนละ endpoint (POST /patients/.../profile)
 * ที่กรอกทีหลังโดยเจ้าหน้าที่/ผู้ป่วยเอง ไม่ใช่ตอนสมัครบัญชี
 */
export const registerSchema = baseRegisterFields
  .extend({
    role: z.enum(["patient", "caregiver"]),
    ...Object.fromEntries(
      Object.entries(caregiverProfileFields).map(([key, schema]) => [key, schema.optional()])
    ),
  })
  .superRefine((data, ctx) => {
    if (data.role !== "caregiver") return;
    for (const field of Object.keys(caregiverProfileFields) as Array<keyof typeof caregiverProfileFields>) {
      if ((data as Record<string, unknown>)[field] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required when role is "caregiver"`,
        });
      }
    }
  });
export type RegisterBody = z.infer<typeof registerSchema>;

/**
 * Admin-only: can create any role, including nurse/doctor/admin.
 *
 * บุคลากรล็อกอินด้วย "อีเมล" ไม่ใช่เบอร์ เพราะทำงานหน้าคอมในคลินิก และเว็บ staff ใช้อีเมล
 * ส่ง `email` มา → สร้างบัญชีใน Supabase Auth ด้วย · ไม่ส่ง → ทางเดิม (เก็บ password_hash)
 * ทางเดิมยังเปิดไว้จนกว่าจะย้าย client ครบทุกตัว
 *
 * ไม่บังคับฟิลด์โปรไฟล์ผู้ดูแล — /auth/provision สร้างบัญชี staff (nurse/doctor/admin) เป็นหลัก
 * ถ้า admin ต้องสร้างบัญชีผู้ดูแลแทนใครสักคน ให้ใช้ role=caregiver ผ่าน /auth/register ปกติ
 */
export const provisionSchema = baseRegisterFields.extend({
  role: z.enum(USER_ROLES),
  email: z.string().email().optional(),
  user_name: z.string().min(3).max(50),
});
export type ProvisionBody = z.infer<typeof provisionSchema>;

export const loginSchema = z.object({
  user_name: z.string().min(1),
  // Deliberately no minimum beyond non-empty — the login endpoint must not describe the
  // password policy to an attacker. The byte ceiling is here only so an oversized body never
  // reaches bcrypt, which would spend the work and then ignore the tail anyway.
  password: z.string().min(1).refine((value) => Buffer.byteLength(value, "utf8") <= BCRYPT_MAX_BYTES),
});
export type LoginBody = z.infer<typeof loginSchema>;
