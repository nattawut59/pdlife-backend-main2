import { ApiError } from "../utils/ApiError";
import { isUniqueViolation } from "../utils/supabaseErrors";
import { findUserById, updateUserName } from "../repositories/userRepository";
import {
  createProfile,
  findPatientFull,
  findProfileByUserId,
  listPatients as listPatientsRepo,
  updateProfile,
  type CreatePatientProfileInput,
} from "../repositories/patientProfileRepository";
import { assertCanAccessPatient } from "./patientAccessService";
import type { JwtPayload } from "../utils/jwt";
import type { PatientFullRow, PatientProfileRow } from "../types/database";

export type CreateProfileInput = Omit<CreatePatientProfileInput, "user_id">;

export async function createPatientProfile(
  userId: string,
  input: CreateProfileInput
): Promise<PatientProfileRow> {
  const user = await findUserById(userId);
  if (!user) throw new ApiError(404, "User not found");
  if (user.role !== "patient") throw new ApiError(400, "User is not a patient");

  const existing = await findProfileByUserId(userId);
  if (existing) throw new ApiError(409, "Patient profile already exists");

  try {
    return await createProfile({ user_id: userId, ...input });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, "id_card_number or hn_number already registered");
    }
    throw err;
  }
}

export async function getPatientProfile(
  requester: JwtPayload,
  patientId: string
): Promise<PatientFullRow> {
  await assertCanAccessPatient(requester, patientId);
  const profile = await findPatientFull(patientId);
  if (!profile) throw new ApiError(404, "Patient profile not found");
  return profile;
}

export async function updatePatientProfile(
  requester: JwtPayload,
  patientId: string,
  patch: Partial<CreateProfileInput> & { first_name?: string; last_name?: string }
): Promise<PatientFullRow> {
  await assertCanAccessPatient(requester, patientId);
  if (requester.role === "caregiver") {
    throw new ApiError(403, "Caregivers cannot edit the patient profile");
  }

  const existing = await findProfileByUserId(patientId);
  if (!existing) throw new ApiError(404, "Patient profile not found");

  const { first_name, last_name, ...profilePatch } = patch;
  await updateProfile(patientId, profilePatch);
  if (first_name !== undefined || last_name !== undefined) {
    // ฟอร์มฝั่งเว็บส่งมาทั้งคู่เสมอ (ทั้งสองช่องบังคับกรอก) แต่กันไว้เผื่อผู้เรียกอื่นส่งมาแค่ช่องเดียว
    const currentUser = await findUserById(patientId);
    if (!currentUser) throw new ApiError(404, "User not found");
    await updateUserName(patientId, {
      first_name: first_name ?? currentUser.first_name,
      last_name: last_name ?? currentUser.last_name,
    });
  }

  const full = await findPatientFull(patientId);
  if (!full) throw new ApiError(404, "Patient profile not found");
  return full;
}

export async function listPatients(limit?: number, offset?: number): Promise<PatientFullRow[]> {
  return listPatientsRepo({ limit, offset });
}
