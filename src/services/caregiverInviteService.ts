import { ApiError } from "../utils/ApiError";
import { isUniqueViolation } from "../utils/supabaseErrors";
import { findUserById } from "../repositories/userRepository";
import { findPatientFull } from "../repositories/patientProfileRepository";
import { createLink } from "../repositories/patientCaregiverRepository";
import {
  createInvite as createInviteRow,
  findActiveByCode,
  markRedeemed,
} from "../repositories/caregiverInviteRepository";
import { assertCanAccessPatient } from "./patientAccessService";
import type { JwtPayload } from "../utils/jwt";
import type { PatientCaregiverRow } from "../types/database";

const CODE_LENGTH = 6;
const EXPIRES_IN_MS = 30 * 60 * 1000; // 30 นาที — พอสำหรับพิมพ์รหัสให้กันสดๆ ไม่ใช่เก็บไว้ใช้ทีหลัง
const MAX_GENERATE_ATTEMPTS = 5;

function generateCode(): string {
  return String(Math.floor(Math.random() * 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

export interface CaregiverInvitePreview {
  patient: { first_name: string; last_name: string; age: number; gender: string | null };
  invited_by: { first_name: string; last_name: string } | null;
  expires_at: string;
}

/**
 * ผู้ป่วยเอง หรือผู้ดูแลที่ผูกกับผู้ป่วยรายนี้อยู่แล้ว สร้างรหัส 6 หลักให้ผู้ดูแลใหม่พิมพ์
 * (assertCanAccessPatient เช็คสิทธิ์ให้ครบ — patient เจ้าของบัญชีเอง / caregiver ที่มี active
 * link อยู่แล้ว / staff)
 */
export async function createInvite(
  requester: JwtPayload,
  patientId: string
): Promise<{ code: string; expires_at: string }> {
  await assertCanAccessPatient(requester, patientId);

  const expiresAt = new Date(Date.now() + EXPIRES_IN_MS).toISOString();

  for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
    try {
      const invite = await createInviteRow({
        patient_id: patientId,
        code: generateCode(),
        created_by: requester.sub,
        expires_at: expiresAt,
      });
      return { code: invite.code, expires_at: invite.expires_at };
    } catch (err) {
      // ชนกับรหัสที่ยัง active อยู่ของคนอื่น (unique index บางส่วนใน migration 0008) — สุ่มใหม่
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new ApiError(500, "สร้างรหัสเชิญไม่สำเร็จ ลองใหม่อีกครั้ง");
}

/**
 * ดูตัวอย่างข้อมูลผู้ป่วยก่อนกดยืนยันเข้าร่วมดูแล — เปิดเผยแค่ชื่อ/อายุ/เพศ ไม่ใช่ข้อมูลสุขภาพ
 * ไม่เช็ค role/สิทธิ์ของผู้เรียกเพิ่ม (แค่ต้องล็อกอินอยู่ — requireAuth ที่ route) เพราะตัวรหัส
 * 6 หลักเองคือสิ่งที่พิสูจน์ว่าได้รับเชิญมาจริง และ endpoint นี้ rate-limit ไว้แล้ว (กันไล่เดารหัส)
 */
export async function previewInvite(code: string): Promise<CaregiverInvitePreview> {
  const invite = await findActiveByCode(code);
  if (!invite) {
    throw new ApiError(404, "ไม่พบรหัสเชิญนี้ หรือรหัสหมดอายุแล้ว");
  }

  const patient = await findPatientFull(invite.patient_id);
  if (!patient) {
    throw new ApiError(404, "ไม่พบรหัสเชิญนี้ หรือรหัสหมดอายุแล้ว");
  }

  const inviter = await findUserById(invite.created_by);

  return {
    patient: {
      first_name: patient.first_name,
      last_name: patient.last_name,
      age: patient.age,
      gender: patient.gender,
    },
    invited_by: inviter ? { first_name: inviter.first_name, last_name: inviter.last_name } : null,
    expires_at: invite.expires_at,
  };
}

export interface RedeemInviteResult {
  link: PatientCaregiverRow;
  patient: { id: string; first_name: string; last_name: string };
}

/**
 * ยืนยันเข้าร่วมดูแล — ผูกบัญชีผู้ดูแล (requester) กับผู้ป่วยของรหัสนี้ทันที ไม่มีขั้นรอ Admin
 * อนุมัติ (ต่างจากแนวคิด QR เดิมที่เคยร่างไว้ฝั่ง frontend แต่ไม่เคยสร้างจริง)
 *
 * mark redeemed "ก่อน" สร้าง link เสมอ (ไม่ใช่สร้าง link ก่อนแล้วค่อย mark) — markRedeemed เป็น
 * conditional update บน redeemed_at IS NULL ในตัว query เอง ทำให้เป็นจุดเดียวที่ "แย่งชิง" กันได้
 * ปลอดภัยเมื่อมีสอง request ยิง redeem รหัสเดียวกันมาพร้อมกัน (เช่น กดปุ่มซ้ำ) — ผู้แพ้จะได้ 410
 * ไปตั้งแต่ก่อนแตะตาราง patient_caregivers เลย ไม่มีทางเกิดบัญชีสองคนผูกกับรหัสเดียวกันได้พร้อมกัน
 */
export async function redeemInvite(
  requester: JwtPayload,
  code: string,
  relationship?: string
): Promise<RedeemInviteResult> {
  const invite = await findActiveByCode(code);
  if (!invite) {
    throw new ApiError(404, "ไม่พบรหัสเชิญนี้ หรือรหัสหมดอายุแล้ว");
  }

  const claimed = await markRedeemed(invite.id, requester.sub);
  if (!claimed) {
    throw new ApiError(410, "รหัสนี้เพิ่งถูกใช้ไปแล้ว กรุณาขอรหัสใหม่");
  }

  let link: PatientCaregiverRow;
  try {
    link = await createLink({
      patient_id: invite.patient_id,
      caregiver_id: requester.sub,
      relationship,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, "คุณเชื่อมโยงกับผู้ป่วยรายนี้อยู่แล้ว");
    }
    throw err;
  }

  const patient = await findPatientFull(invite.patient_id);
  return {
    link,
    patient: {
      id: invite.patient_id,
      first_name: patient?.first_name ?? "",
      last_name: patient?.last_name ?? "",
    },
  };
}
