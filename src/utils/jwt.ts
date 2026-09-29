import jwt, { type SignOptions, type VerifyOptions } from "jsonwebtoken";
import { env } from "../config/env";
import type { UserRole } from "../config/constants";

export interface JwtPayload {
  sub: string;
  role: UserRole;
}

// ระบุว่าใครเป็นคนออก token และออกให้ระบบไหนใช้ ถ้าวันหนึ่ง JWT_SECRET ถูกคัดลอกไปใช้กับบริการอื่น
// (เกิดบ่อยเพราะคนก๊อป .env ข้ามโปรเจกต์) token จากบริการนั้นจะถูกปฏิเสธที่นี่ แทนที่จะผ่านเข้ามาเงียบๆ
//
// จงใจใช้ค่าคงที่ ไม่ใช่ตัวแปรใน .env เพราะสองค่านี้ระบุ "ตัวบริการ" ไม่ใช่ "สภาพแวดล้อมที่รัน" —
// เครื่อง dev กับ production เป็น pdlife-api เหมือนกัน ถ้าทำเป็น env var จะเพิ่มโอกาสตั้งไม่ตรงกัน
// ระหว่างเครื่องแล้ว token ใช้ข้ามไม่ได้โดยไม่ตั้งใจ
const ISSUER = "pdlife-api";
const AUDIENCE = "pdlife-app";

// บังคับอัลกอริทึมจากฝั่งเรา ไม่ปล่อยให้ header ของ token เป็นคนเลือกวิธีตรวจสอบตัวมันเอง
//
// วันนี้ยังโจมตีไม่ได้จริง เพราะ jsonwebtoken v9 ปฏิเสธ alg:none เป็นค่าเริ่มต้น และ secret เป็น
// string ธรรมดาจึงสับไปใช้กุญแจอสมมาตรไม่ได้ — แต่วันที่ย้ายไปใช้ Supabase Auth ซึ่งเซ็นด้วยกุญแจ
// อสมมาตร การไม่ pin จะเปิดช่องโหว่ HS/RS confusion ขึ้นมาทันที บรรทัดนี้คือการปิดประตูล่วงหน้า
const ALGORITHM = "HS256" as const;

export function signToken(payload: JwtPayload): string {
  const options: SignOptions = {
    expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"],
    algorithm: ALGORITHM,
    issuer: ISSUER,
    audience: AUDIENCE,
  };
  return jwt.sign(payload, env.jwtSecret, options);
}

export function verifyToken(token: string): JwtPayload {
  // ระบุเงื่อนไขให้ครบทั้งสามอย่าง ลายเซ็นถูกต้องอย่างเดียวไม่พออีกต่อไป
  const options: VerifyOptions = {
    algorithms: [ALGORITHM],
    issuer: ISSUER,
    audience: AUDIENCE,
  };
  return jwt.verify(token, env.jwtSecret, options) as JwtPayload;
}
