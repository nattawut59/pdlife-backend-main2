import { ApiError } from "../utils/ApiError";
import { supabase, createAuthVerifierClient } from "../config/supabaseClient";
import { hashPassword, verifyPassword } from "../utils/password";
import { signToken } from "../utils/jwt";
import { isUniqueViolation } from "../utils/supabaseErrors";
import {
  createUser,
  deleteUser,
  findUserById,
  findUserByUsername,
  touchLastLogin,
} from "../repositories/userRepository";
import { createProfile as createCaregiverProfile } from "../repositories/caregiverProfileRepository";
import type { CaregiverProfileRow, UserRow } from "../types/database";

export type SafeUser = Omit<UserRow, "password_hash">;

function toSafeUser(user: UserRow): SafeUser {
  const { password_hash: _password_hash, ...safe } = user;
  return safe;
}

export interface RegisterInput {
  first_name: string;
  last_name: string;
  password: string;
  role: UserRow["role"];
  /** เบอร์โทรรูปแบบสากล (+66…) — authSchema แปลงมาให้แล้ว */
  phone_number: string;
  /** ถ้าไม่ส่งมา จะตั้งให้เท่ากับเบอร์โทร */
  user_name?: string;
  preferred_language?: UserRow["preferred_language"];
  /**
   * ฟิลด์โปรไฟล์ผู้ดูแล — บังคับมีเมื่อ role === "caregiver" เท่านั้น (authSchema.registerSchema
   * เช็คให้ครบก่อนถึงชั้นนี้แล้ว) role อื่นไม่ใช้ฟิลด์พวกนี้
   */
  prefix?: string;
  gender?: CaregiverProfileRow["gender"];
  date_of_birth?: string;
  relationship?: string;
  address_line?: string;
  subdistrict?: string;
  district?: string;
  province?: string;
  postal_code?: string;
}

/**
 * ทางเดิม — เก็บ password_hash ไว้ในตารางเราเอง
 *
 * เหลือไว้ให้ /auth/provision ที่ไม่ส่ง email มาเท่านั้น ระหว่างที่ยังมี client บางตัวใช้
 * POST /api/auth/login อยู่ จะถูกลบทิ้งในเฟส 3 พร้อมกับ password.ts และ signToken
 */
async function createLegacyUser(input: RegisterInput & { user_name: string }): Promise<SafeUser> {
  const password_hash = await hashPassword(input.password);
  try {
    const user = await createUser({
      first_name: input.first_name,
      last_name: input.last_name,
      user_name: input.user_name,
      password_hash,
      role: input.role,
      phone_number: input.phone_number,
      preferred_language: input.preferred_language,
    });
    return toSafeUser(user);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, "user_name is already taken");
    throw err;
  }
}

/**
 * ผู้ป่วย/ผู้ดูแลสมัครเอง — สร้างบัญชีใน Supabase Auth ด้วย "เบอร์โทร + รหัสผ่าน"
 *
 * ใช้เบอร์เป็นตัวระบุตัวตนแทน username เพราะ Supabase Auth ไม่รองรับ username และเบอร์เป็น
 * สิ่งที่ผู้ป่วยสูงอายุจำได้อยู่แล้วโดยไม่ต้องคิดใหม่
 *
 * ตั้ง phone_confirm: true เพื่อ "ไม่ส่ง SMS" — เบอร์ทำหน้าที่เป็นชื่อผู้ใช้เท่านั้น ไม่ได้ใช้เป็น
 * ช่องทางยืนยันตัวตน จึงไม่มีค่า SMS เกิดขึ้นเลยแม้แต่ข้อความเดียว (ถ้าวันหนึ่งอยากเปิด OTP
 * สำหรับกู้รหัสผ่าน ทำได้จากฝั่งแอปโดยไม่ต้องแก้ backend)
 *
 * รหัสผ่านไม่ถูกเก็บที่เราอีกต่อไป — password_hash เป็น NULL
 */
export async function register(input: RegisterInput): Promise<SafeUser> {
  const userName = input.user_name ?? input.phone_number;

  const created = await supabase.auth.admin.createUser({
    phone: input.phone_number,
    password: input.password,
    phone_confirm: true,
  });
  if (created.error || !created.data.user) {
    // เบอร์ซ้ำเป็นกรณีที่เจอบ่อยที่สุด แยกออกมาให้ผู้ใช้เข้าใจได้ว่าต้องทำอะไรต่อ
    const message = created.error?.message ?? "unknown";
    const status = /already|exists|registered/i.test(message) ? 409 : 400;
    throw new ApiError(status, `Could not create the account: ${message}`);
  }
  const authUid = created.data.user.id;

  let user: UserRow;
  try {
    user = await createUser({
      first_name: input.first_name,
      last_name: input.last_name,
      user_name: userName,
      auth_uid: authUid,
      role: input.role,
      phone_number: input.phone_number,
      preferred_language: input.preferred_language,
    });
  } catch (err) {
    // ย้อนกลับให้สุด ไม่ปล่อยให้เหลือบัญชีที่ล็อกอินได้แต่ไม่มีโปรไฟล์ และสมัครใหม่ก็ไม่ได้
    const rollback = await supabase.auth.admin.deleteUser(authUid);
    if (rollback.error) {
      console.error(`Orphaned Supabase Auth user ${authUid} — profile creation failed and rollback also failed`, rollback.error);
    }
    if (isUniqueViolation(err)) throw new ApiError(409, "This phone number is already registered");
    throw err;
  }

  if (input.role === "caregiver") {
    // authSchema.registerSchema บังคับให้ฟิลด์เหล่านี้มาครบแล้วเมื่อ role เป็น caregiver
    try {
      await createCaregiverProfile({
        user_id: user.id,
        prefix: input.prefix!,
        gender: input.gender!,
        date_of_birth: input.date_of_birth!,
        relationship: input.relationship!,
        address_line: input.address_line!,
        subdistrict: input.subdistrict!,
        district: input.district!,
        province: input.province!,
        postal_code: input.postal_code!,
      });
    } catch (err) {
      // ย้อนกลับทั้งสองชั้น — ลบ users row ก่อน (cascade ลบ caregiver_profiles ถ้าไปสร้างสำเร็จ
      // บางส่วน) แล้วค่อยลบบัญชี Supabase Auth ไม่ปล่อยให้เหลือบัญชีล็อกอินได้แต่โปรไฟล์ไม่ครบ
      await deleteUser(user.id).catch((deleteErr) => {
        console.error(`Orphaned pdlife.users row ${user.id} — caregiver profile creation failed and rollback also failed`, deleteErr);
      });
      const rollback = await supabase.auth.admin.deleteUser(authUid);
      if (rollback.error) {
        console.error(`Orphaned Supabase Auth user ${authUid} — caregiver profile creation failed and rollback also failed`, rollback.error);
      }
      throw err;
    }
  }

  return toSafeUser(user);
}

export interface ProvisionInput extends RegisterInput {
  /** บุคลากรต้องระบุ user_name เสมอ ต่างจากผู้ป่วยที่ระบบตั้งให้เป็นเบอร์ */
  user_name: string;
  role: UserRow["role"];
  /** ถ้าส่งมา จะสร้างบัญชีใน Supabase Auth ด้วยแล้วผูกผ่าน auth_uid */
  email?: string;
}

/**
 * สร้างบัญชีให้บุคลากร (หมอ/พยาบาล/admin) — เรียกได้เฉพาะ admin
 *
 * เมื่อมี `email` จะสร้าง 2 ที่: บัญชีใน Supabase Auth (ไว้ล็อกอินเข้าเว็บ) และโปรไฟล์ใน
 * pdlife.users (ไว้เก็บ role และสิทธิ์) เชื่อมกันด้วย auth_uid — โปรไฟล์ไม่เก็บรหัสผ่านอีก
 *
 * ใช้ email_confirm: true เพราะ admin เป็นคนรับรองอีเมลอยู่แล้ว ไม่ต้องให้เจ้าตัวยืนยัน
 * (ผลข้างเคียง: ถ้า admin พิมพ์อีเมลผิด บัญชีจะถูกสร้างให้อีเมลที่ไม่มีอยู่จริง — ฟอร์มฝั่งเว็บ
 * ควรให้กรอกอีเมลสองครั้ง)
 *
 * ถ้าสร้างโปรไฟล์ไม่สำเร็จ จะลบบัญชี Supabase ที่เพิ่งสร้างทิ้ง ไม่ให้เหลือบัญชีค้างที่ล็อกอินได้
 * แต่ใช้ระบบไม่ได้ และสร้างใหม่ก็ไม่ได้เพราะอีเมลซ้ำ
 */
export async function provision(input: ProvisionInput): Promise<SafeUser> {
  if (!input.email) {
    // ทางเดิม — ยังรองรับไว้จนกว่าทุก client จะย้ายไป Supabase Auth ครบ
    return createLegacyUser(input);
  }

  const created = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new ApiError(400, `Could not create the Supabase Auth account: ${created.error?.message ?? "unknown"}`);
  }
  const authUid = created.data.user.id;

  try {
    const user = await createUser({
      first_name: input.first_name,
      last_name: input.last_name,
      user_name: input.user_name,
      auth_uid: authUid,
      role: input.role,
      phone_number: input.phone_number,
      preferred_language: input.preferred_language,
    });
    return toSafeUser(user);
  } catch (err) {
    // ย้อนกลับให้สุด ไม่ปล่อยให้บัญชีค้างครึ่งเดียว
    const rollback = await supabase.auth.admin.deleteUser(authUid);
    if (rollback.error) {
      console.error(`Orphaned Supabase Auth user ${authUid} — profile creation failed and rollback also failed`, rollback.error);
    }
    if (isUniqueViolation(err)) {
      throw new ApiError(409, "user_name is already taken");
    }
    throw err;
  }
}

export interface LoginInput {
  user_name: string;
  password: string;
}

export interface LoginResult {
  token: string;
  user: SafeUser;
}

/**
 * บั๊กที่แก้ไป: เดิมฟังก์ชันนี้เช็คแค่ password_hash — ใช้ได้เฉพาะบัญชีทางเดิม
 * (createLegacyUser) แต่ทุกบัญชีที่สมัครผ่าน register()/provision()+email (สร้างใน
 * Supabase Auth) มี password_hash เป็น NULL เสมอ (รหัสผ่านเก็บที่ Supabase ไม่ใช่
 * ที่เรา) ผลคือสมัครสำเร็จแล้วแต่ล็อกอินไม่ได้เลย ขึ้น "Invalid username or
 * password" ทุกครั้งแม้กรอกรหัสถูก — เพิ่ม path ที่สอง: ถ้าไม่มี password_hash
 * แต่มี auth_uid ให้ตรวจรหัสผ่านผ่าน Supabase Auth แทน bcrypt
 */
export async function login(input: LoginInput): Promise<LoginResult> {
  const user = await findUserByUsername(input.user_name);
  if (!user) {
    throw new ApiError(401, "Invalid username or password");
  }
  if (!user.is_active) {
    throw new ApiError(403, "This account has been deactivated");
  }

  if (user.password_hash) {
    const valid = await verifyPassword(input.password, user.password_hash);
    if (!valid) {
      throw new ApiError(401, "Invalid username or password");
    }
  } else if (user.auth_uid) {
    // ไม่เก็บเบอร์/อีเมลที่ผูกกับ Supabase Auth แยกไว้ต่างหาก — register() ผูก
    // ด้วยเบอร์เสมอ, provision()+email ผูกด้วยอีเมล ต้องถาม Supabase Auth ตรงๆ
    // ว่าบัญชีนี้ใช้ตัวไหน ก่อนจะเรียก signInWithPassword ให้ถูก
    const authUser = await supabase.auth.admin.getUserById(user.auth_uid);
    const identifier = authUser.data.user?.phone
      ? { phone: authUser.data.user.phone }
      : authUser.data.user?.email
        ? { email: authUser.data.user.email }
        : null;
    if (authUser.error || !identifier) {
      throw new ApiError(401, "Invalid username or password");
    }

    // ⚠️ ต้องใช้ client แยก ห้ามเรียกบน `supabase` singleton — ดูคอมเมนต์เต็มที่
    // createAuthVerifierClient() (config/supabaseClient.ts) ว่าทำไม
    const signIn = await createAuthVerifierClient().auth.signInWithPassword({
      ...identifier,
      password: input.password,
    });
    if (signIn.error) {
      throw new ApiError(401, "Invalid username or password");
    }
  } else {
    // ไม่มีทั้ง password_hash และ auth_uid — บัญชีสร้างไม่ครบ ไม่ใช่รหัสผิด แต่
    // ตอบ 401 แบบเดียวกันไปก่อน (ไม่บอกรายละเอียดออกไปข้างนอกว่าบัญชีมีปัญหา)
    throw new ApiError(401, "Invalid username or password");
  }

  await touchLastLogin(user.id);

  const token = signToken({ sub: user.id, role: user.role });
  return { token, user: toSafeUser(user) };
}

export async function getCurrentUser(id: string): Promise<SafeUser> {
  const user = await findUserById(id);
  if (!user) {
    throw new ApiError(404, "User not found");
  }
  return toSafeUser(user);
}
