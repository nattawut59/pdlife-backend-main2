import { ApiError } from "../utils/ApiError";
import { isUniqueViolation } from "../utils/supabaseErrors";
import { ID_CARD_PATTERN, HN_PATTERN } from "../utils/patientIdentifier";
import { findUserById } from "../repositories/userRepository";
import {
  findPatientFullByIdCard,
  findPatientFullByHn,
} from "../repositories/patientProfileRepository";
import {
  createLink,
  findActiveLink,
  findLinkById,
  listByCaregiver,
  listByPatient,
  updateLink,
  type CreateCaregiverLinkInput,
} from "../repositories/patientCaregiverRepository";
import { assertCanAccessPatient } from "./patientAccessService";
import type { JwtPayload } from "../utils/jwt";
import type { PatientCaregiverRow, PatientFullRow } from "../types/database";
import { findProfileByUserId as findCaregiverProfile } from "../repositories/caregiverProfileRepository";

export type LinkCaregiverInput = Omit<CreateCaregiverLinkInput, "patient_id">;

export async function linkCaregiver(
  requester: JwtPayload,
  patientId: string,
  input: LinkCaregiverInput
): Promise<PatientCaregiverRow> {
  await assertCanAccessPatient(requester, patientId);
  if (requester.role === "caregiver") {
    throw new ApiError(403, "Caregivers cannot create their own link");
  }

  const caregiverUser = await findUserById(input.caregiver_id);
  if (!caregiverUser || caregiverUser.role !== "caregiver") {
    throw new ApiError(400, "caregiver_id must belong to a user with role = caregiver");
  }

  try {
    return await createLink({ patient_id: patientId, ...input });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, "This caregiver is already linked to this patient");
    }
    throw err;
  }
}

export async function listCaregiversForPatient(
  requester: JwtPayload,
  patientId: string
): Promise<PatientCaregiverRow[]> {
  await assertCanAccessPatient(requester, patientId);
  return listByPatient(patientId);
}

export async function getCaregiverForPatient(
  requester: JwtPayload,
  patientId: string,
  caregiverId: string
) {
  await assertCanAccessPatient(requester, patientId);
  const link = await findActiveLink(patientId, caregiverId);
  if (!link) throw new ApiError(404, "Caregiver link not found");
  const [user, profile] = await Promise.all([findUserById(caregiverId), findCaregiverProfile(caregiverId)]);
  if (!user || user.role !== "caregiver") throw new ApiError(404, "Caregiver not found");
  return {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    phone_number: user.phone_number,
    address: profile
      ? [profile.address_line, profile.subdistrict, profile.district, profile.province, profile.postal_code].filter(Boolean).join(" ")
      : null,
  };
}

export async function listPatientsForCaregiver(
  caregiverId: string
): Promise<PatientCaregiverRow[]> {
  return listByCaregiver(caregiverId);
}

export async function updateCaregiverLink(
  requester: JwtPayload,
  patientId: string,
  linkId: string,
  patch: Partial<Pick<PatientCaregiverRow, "relationship" | "can_answer" | "is_primary" | "active">>
): Promise<PatientCaregiverRow> {
  await assertCanAccessPatient(requester, patientId);
  if (requester.role === "caregiver") {
    throw new ApiError(403, "Caregivers cannot modify their own link");
  }

  const link = await findLinkById(linkId);
  if (!link || link.patient_id !== patientId) {
    throw new ApiError(404, "Caregiver link not found");
  }

  return updateLink(linkId, patch);
}

async function findPatientByIdentifier(identifier: string): Promise<PatientFullRow | null> {
  if (ID_CARD_PATTERN.test(identifier)) return findPatientFullByIdCard(identifier);
  if (HN_PATTERN.test(identifier)) return findPatientFullByHn(identifier);
  return null;
}

export interface PatientSearchPreview {
  id: string;
  first_name: string;
  last_name: string;
  age: number;
  gender: string | null;
  date_of_birth: string;
  id_card_number: string | null;
  hn_number: string | null;
}

function toSearchPreview(patient: PatientFullRow): PatientSearchPreview {
  return {
    id: patient.id,
    first_name: patient.first_name,
    last_name: patient.last_name,
    age: patient.age,
    gender: patient.gender,
    date_of_birth: patient.date_of_birth,
    id_card_number: patient.id_card_number,
    hn_number: patient.hn_number,
  };
}

/**
 * ค้นผู้ป่วยด้วยเลขบัตรประชาชน/HN — ให้ผู้ดูแลเห็นชื่อ/อายุ/เพศ (ไม่ใช่ข้อมูลสุขภาพ) ยืนยันว่าใช่
 * คนที่ตามหาก่อนกด "เพิ่มผู้ป่วยใหม่" จริง (ต่างจากรหัสเชิญ 6 หลักตรงที่เลขบัตร/HN ไม่ใช่ secret ที่
 * สุ่มมาเพื่อจุดประสงค์นี้โดยเฉพาะ — จำกัด role=caregiver + rate-limit แน่นกว่า caregiverInvite
 * ที่ route เป็นแนวป้องกันชั้นเดียวที่มีตอนนี้ ดูคอมเมนต์เต็มที่ linkPatientByIdentifier ด้านล่าง)
 */
export async function searchPatientByIdentifier(
  requester: JwtPayload,
  identifier: string
): Promise<PatientSearchPreview> {
  if (requester.role !== "caregiver") {
    throw new ApiError(403, "ใช้งานได้เฉพาะบัญชีผู้ดูแล");
  }
  const patient = await findPatientByIdentifier(identifier);
  if (!patient) {
    throw new ApiError(404, "ไม่พบผู้ป่วยที่ตรงกับเลขนี้ในระบบ");
  }
  return toSearchPreview(patient);
}

/**
 * ผูกผู้ดูแล (requester) กับผู้ป่วยที่ค้นเจอทันที — ไม่มีขั้นรอผู้ป่วยกดยืนยัน ต่างจาก
 * linkCaregiver ปกติด้านบน (ที่บล็อก role=caregiver ไว้เพื่อกันสร้าง link ให้ตัวเอง) endpoint
 * นี้เปิดทางให้เฉพาะกรณี "ค้นด้วยเลขบัตร/HN" เท่านั้น
 *
 * ⚠️ ตัดสินใจร่วมกับผู้ใช้แล้ว (ไม่ใช่มองข้าม) — เหตุผล: ผู้ป่วยกลุ่มเป้าหมายของแอปนี้
 * (พาร์กินสัน) จำนวนมากใช้แอปเองไม่ได้ตามระยะโรค การบังคับให้ผู้ป่วยกดอนุมัติก่อนทุกครั้งจะทำให้
 * ฟีเจอร์นี้ใช้งานจริงไม่ได้กับกลุ่มที่ต้องการมันมากที่สุด (ผู้ดูแลมืออาชีพ/ญาติที่ไม่ใช่คนในบ้าน
 * เดียวกัน ซึ่งไม่มีทาง "ขอรหัสเชิญ" จากผู้ป่วยที่ใช้แอปไม่เป็น) — ผู้ที่รู้เลขบัตร/HN ของผู้ป่วย
 * ถือว่าเป็นคนที่ผู้ป่วย/ครอบครัวไว้ใจอยู่แล้ว เทียบเท่ารู้รหัสเชิญ
 *
 * ความเสี่ยงที่เหลืออยู่จริง (ไม่ได้ถูกกำจัดหมด แค่ยอมรับแลกกับใช้งานได้จริง): เลข HN เป็นเลขรัน
 * (เดาช่วงได้ง่ายกว่ารหัสเชิญ 6 หลักสุ่ม) บัญชี caregiver ที่ถูกขโมย/สร้างปลอมสามารถลองไล่เลข HN
 * ทีละค่าได้ — searchPatientLimiter ที่ route (จำกัดต่อบัญชีผู้เรียก ไม่ใช่ต่อ IP) เป็นด่านเดียวที่
 * กันไว้ตอนนี้ ไม่ใช่การป้องกันที่สมบูรณ์ ถ้าจะปิดช่องนี้เพิ่มในอนาคตต้องคุยเรื่อง audit
 * แจ้งเตือนผู้ป่วย/ผู้ดูแลเดิมทุกครั้งที่มีคนเชื่อมใหม่ (ยังไม่ได้ทำในรอบนี้)
 */
export async function linkPatientByIdentifier(
  requester: JwtPayload,
  identifier: string,
  relationship?: string
): Promise<{ link: PatientCaregiverRow; patient: PatientSearchPreview }> {
  if (requester.role !== "caregiver") {
    throw new ApiError(403, "ใช้งานได้เฉพาะบัญชีผู้ดูแล");
  }
  const patient = await findPatientByIdentifier(identifier);
  if (!patient) {
    throw new ApiError(404, "ไม่พบผู้ป่วยที่ตรงกับเลขนี้ในระบบ");
  }

  const existing = await findActiveLink(patient.id, requester.sub);
  if (existing) {
    throw new ApiError(409, "คุณเชื่อมโยงกับผู้ป่วยรายนี้อยู่แล้ว");
  }

  try {
    const link = await createLink({
      patient_id: patient.id,
      caregiver_id: requester.sub,
      relationship,
    });
    return { link, patient: toSearchPreview(patient) };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, "คุณเชื่อมโยงกับผู้ป่วยรายนี้อยู่แล้ว");
    }
    throw err;
  }
}
