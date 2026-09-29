import type { JwtPayload } from "../utils/jwt";
import { ApiError } from "../utils/ApiError";
import { isUniqueViolation } from "../utils/supabaseErrors";
import { assertCanAccessPatient } from "./patientAccessService";
import * as allergyRepository from "../repositories/allergyRepository";

export async function list(requester: JwtPayload, patientId: string) {
  await assertCanAccessPatient(requester, patientId);
  return allergyRepository.listByPatient(patientId);
}

export async function add(requester: JwtPayload, patientId: string, substance: string) {
  await assertCanAccessPatient(requester, patientId);
  if (requester.role === "caregiver") throw new ApiError(403, "Caregivers cannot edit allergies");
  try {
    return await allergyRepository.create({ patient_id: patientId, substance: substance.trim(), created_by: requester.sub });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, "This allergy is already recorded");
    throw error;
  }
}

export async function remove(requester: JwtPayload, patientId: string, allergyId: string) {
  await assertCanAccessPatient(requester, patientId);
  if (requester.role === "caregiver") throw new ApiError(403, "Caregivers cannot edit allergies");
  const allergy = await allergyRepository.findById(allergyId);
  if (!allergy || allergy.patient_id !== patientId) throw new ApiError(404, "Allergy not found");
  await allergyRepository.remove(allergyId);
}
