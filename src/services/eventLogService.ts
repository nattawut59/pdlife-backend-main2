import { ApiError } from "../utils/ApiError";
import type { JwtPayload } from "../utils/jwt";
import { assertCanAccessPatient } from "./patientAccessService";
import { raiseRedFlagForEvent } from "./redFlagService";
import {
  createEventLog,
  listByPatient,
  type CreateEventLogInput,
} from "../repositories/eventLogRepository";
import type { FlagSeverity } from "../config/constants";
import type { EventLogRow } from "../types/database";

export type ReportEventInput = Omit<CreateEventLogInput, "patient_id" | "recorded_by">;

/**
 * แปลง event_logs.severity (moderate/severe/critical ที่ผู้ป่วยเลือกเอง) เป็น
 * red_flags.severity (red/urgent) — required_er ชนะเสมอเพราะการไปห้องฉุกเฉินจริงเป็น
 * สัญญาณที่หนักแน่นกว่าคำอธิบายความรุนแรงที่เลือกเอง moderate ไม่ยิง red flag เลย
 * (เหมือนหลักการ §9.5 ที่ warning ไม่เข้าคิว urgent) แต่ยังอยู่ในรายการเหตุการณ์ปกติ
 */
export function classifyEventSeverity(input: {
  severity: "moderate" | "severe" | "critical";
  required_er: boolean;
}): FlagSeverity | null {
  if (input.required_er) return "urgent";
  if (input.severity === "critical") return "urgent";
  if (input.severity === "severe") return "red";
  return null;
}

export async function reportEvent(
  requester: JwtPayload,
  patientId: string,
  input: ReportEventInput
): Promise<EventLogRow> {
  if (requester.role !== "patient" && requester.role !== "caregiver") {
    throw new ApiError(403, "Only the patient or a caregiver can report an event");
  }
  await assertCanAccessPatient(requester, patientId, { requireAnswerPermission: true });

  const eventLog = await createEventLog({
    ...input,
    patient_id: patientId,
    recorded_by: requester.role === "caregiver" ? requester.sub : null,
  });

  const severity = classifyEventSeverity(input);
  if (severity) {
    await raiseRedFlagForEvent(patientId, eventLog.id, {
      clinic_tag: input.event_type,
      severity,
    });
  }

  return eventLog;
}

export async function listEventLogsForPatient(
  requester: JwtPayload,
  patientId: string
): Promise<EventLogRow[]> {
  await assertCanAccessPatient(requester, patientId);
  return listByPatient(patientId);
}
