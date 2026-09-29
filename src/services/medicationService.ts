import { ApiError } from "../utils/ApiError";
import { isUniqueViolation } from "../utils/supabaseErrors";
import {
  createMedication as createMedicationRepo,
  findMedicationById,
  listMedications as listMedicationsRepo,
  updateMedication as updateMedicationRepo,
  type CreateMedicationInput,
} from "../repositories/medicationRepository";
import { listAllActive as listAllActivePrescriptions } from "../repositories/patientMedicationRepository";
import type { MedicationRow, PatientMedicationRow } from "../types/database";

/**
 * นับผู้ป่วยที่ไม่ซ้ำต่อยา (ไม่ใช่จำนวนแถวใบสั่งยา) — ไม่มี unique constraint ห้ามผู้ป่วยคนเดียว
 * มีใบสั่งยา active 2 ใบของยาเดียวกัน (เช่น เปลี่ยนขนาดยาแล้วลืมปิดใบเก่า) นับแถวตรงๆ จะได้เลข
 * สูงเกินจริง
 */
export function countActivePatientsByMedication(
  prescriptions: PatientMedicationRow[]
): Record<string, number> {
  const patientsByMedication = new Map<string, Set<string>>();
  for (const p of prescriptions) {
    const patients = patientsByMedication.get(p.medication_id) ?? new Set<string>();
    patients.add(p.patient_id);
    patientsByMedication.set(p.medication_id, patients);
  }

  const counts: Record<string, number> = {};
  for (const [medicationId, patients] of patientsByMedication) {
    counts[medicationId] = patients.size;
  }
  return counts;
}

export async function listMedications(): Promise<
  Array<MedicationRow & { active_patients: number }>
> {
  const [medications, activePrescriptions] = await Promise.all([
    listMedicationsRepo(),
    listAllActivePrescriptions(),
  ]);
  const counts = countActivePatientsByMedication(activePrescriptions);
  return medications.map((m) => ({ ...m, active_patients: counts[m.id] ?? 0 }));
}

export async function getMedication(id: string): Promise<MedicationRow> {
  const medication = await findMedicationById(id);
  if (!medication) throw new ApiError(404, "Medication not found");
  return medication;
}

export async function createMedication(input: CreateMedicationInput): Promise<MedicationRow> {
  try {
    return await createMedicationRepo(input);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, `Medication ${input.id} already exists`);
    }
    throw err;
  }
}

export async function updateMedication(
  id: string,
  patch: Partial<Omit<CreateMedicationInput, "id">> & { status?: MedicationRow["status"] }
): Promise<MedicationRow> {
  await getMedication(id);
  return updateMedicationRepo(id, patch);
}
