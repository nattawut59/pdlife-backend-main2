import { ApiError } from "../utils/ApiError";
import type { JwtPayload } from "../utils/jwt";
import { assertCanAccessPatient } from "./patientAccessService";
import { getMedication } from "./medicationService";
import { findUserById } from "../repositories/userRepository";
import {
  createPrescription as createPrescriptionRepo,
  findPrescriptionById,
  listByPatient,
  updatePrescription as updatePrescriptionRepo,
  type CreatePrescriptionInput,
} from "../repositories/patientMedicationRepository";
import type { PatientMedicationRow } from "../types/database";

export type PrescribeInput = Omit<
  CreatePrescriptionInput,
  "patient_id" | "prescribed_by" | "prescribed_by_name"
>;

export async function createPrescription(
  prescriber: JwtPayload,
  patientId: string,
  input: PrescribeInput
): Promise<PatientMedicationRow> {
  await assertCanAccessPatient(prescriber, patientId);
  // admin รวมอยู่ด้วยตามคำขอ (2026-09) — เดิมจำกัดแค่ doctor/nurse ผู้ใช้ยืนยันแล้วว่าต้องการ
  // ให้ admin สั่งยาได้จริง ไม่ใช่แค่ทางลัดตอนทดสอบ (route ที่เรียกมาถึงนี่ก็เปิดให้ admin แล้ว
  // เหมือนกัน เช็คซ้ำที่นี่เพราะ service เป็นด่านจริงตามธรรมเนียมของไฟล์นี้)
  if (prescriber.role !== "doctor" && prescriber.role !== "nurse" && prescriber.role !== "admin") {
    throw new ApiError(403, "Only doctors, nurses, or admins can prescribe medication");
  }

  await getMedication(input.medication_id); // 404s if the drug isn't in the catalog

  const mismatchedDoseKeys = Object.keys(input.doses).filter(
    (time) => !input.scheduled_times.includes(time)
  );
  if (mismatchedDoseKeys.length > 0) {
    throw new ApiError(
      400,
      `doses keys must match scheduled_times: ${mismatchedDoseKeys.join(", ")}`
    );
  }

  const prescriberUser = await findUserById(prescriber.sub);
  if (!prescriberUser) throw new ApiError(404, "Prescriber not found");

  return createPrescriptionRepo({
    patient_id: patientId,
    prescribed_by: prescriber.sub,
    prescribed_by_name: `${prescriberUser.first_name} ${prescriberUser.last_name}`,
    ...input,
  });
}

export async function listPrescriptionsForPatient(
  requester: JwtPayload,
  patientId: string,
  activeOnly = true
): Promise<PatientMedicationRow[]> {
  await assertCanAccessPatient(requester, patientId);
  return listByPatient(patientId, activeOnly);
}

export async function updatePrescription(
  requester: JwtPayload,
  prescriptionId: string,
  patch: Partial<
    Pick<
      PatientMedicationRow,
      "scheduled_times" | "doses" | "frequency" | "special_instructions" | "end_date" | "active"
    >
  >
): Promise<PatientMedicationRow> {
  const prescription = await findPrescriptionById(prescriptionId);
  if (!prescription) throw new ApiError(404, "Prescription not found");

  await assertCanAccessPatient(requester, prescription.patient_id);
  if (requester.role === "caregiver") {
    throw new ApiError(403, "Caregivers cannot modify prescriptions");
  }

  return updatePrescriptionRepo(prescriptionId, patch);
}
