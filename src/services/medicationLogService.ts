import { ApiError } from "../utils/ApiError";
import type { JwtPayload } from "../utils/jwt";
import { assertCanAccessPatient } from "./patientAccessService";
import { findLogById, listByPatient, listByPatientAndActivityDate, updateLogStatus } from "../repositories/medicationLogRepository";
import type { MedicationLogRow } from "../types/database";

export async function listLogsForPatient(
  requester: JwtPayload,
  patientId: string,
  activityDate?: string
): Promise<MedicationLogRow[]> {
  await assertCanAccessPatient(requester, patientId);
  const logs = activityDate
    ? listByPatientAndActivityDate(patientId, activityDate)
    : listByPatient(patientId);
  return collapseDuplicateMedicationLogs(await logs).map((log) =>
    log.status === "skipped" ? { ...log, status: "pending" } : log
  );
}

const MED_STATUS_PRIORITY: Record<MedicationLogRow["status"], number> = {
  taken: 3,
  skipped: 2,
  pending: 1,
};

/** Same planned dose may exist historically from concurrent scheduler processes; show it once. */
export function collapseDuplicateMedicationLogs(logs: MedicationLogRow[]): MedicationLogRow[] {
  const chosen = new Map<string, MedicationLogRow>();
  for (const log of logs) {
    const key = `${log.prescription_id}:${log.planned_at}`;
    const current = chosen.get(key);
    if (!current || MED_STATUS_PRIORITY[log.status] > MED_STATUS_PRIORITY[current.status]) chosen.set(key, log);
  }
  return [...chosen.values()].sort((a, b) => b.planned_at.localeCompare(a.planned_at));
}

export interface MarkTakenInput {
  dose_taken?: string;
  note?: string;
  submitted_at?: string;
}

/** Patient taps "taken" -> status=taken, taken_at=now. POST_MED_MICRO timing is
 * independent and follows the medication schedule (planned_at). */
export async function markTaken(
  requester: JwtPayload,
  logId: string,
  input: MarkTakenInput
): Promise<MedicationLogRow> {
  const log = await findLogById(logId);
  if (!log) throw new ApiError(404, "Medication log not found");
  await assertCanAccessPatient(requester, log.patient_id, { requireAnswerPermission: true });

  // อนุญาตแก้รายการที่ scheduler รุ่นเก่าเคยตีเป็น skipped อัตโนมัติได้ ผู้ใช้
  // อาจกินยาจริงช้ากว่าเวลาแผนและเพิ่งเข้ามาบันทึกภายหลัง เวลาจริงยังคงเป็น
  // taken_at=now ไม่ใช่ planned_at
  if (log.status !== "pending" && log.status !== "skipped") {
    throw new ApiError(409, `Cannot mark a ${log.status} log as taken`);
  }

  return updateLogStatus(logId, {
    status: "taken",
    taken_at: new Date().toISOString(),
    dose_taken: input.dose_taken,
    note: input.note,
    submitted_at: input.submitted_at,
  });
}
