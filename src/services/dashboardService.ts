import { ApiError } from "../utils/ApiError";
import type { JwtPayload } from "../utils/jwt";
import { assertCanAccessPatient } from "./patientAccessService";
import {
  findById as findAppointmentById,
  findPreviousCompleted as findPreviousCompletedAppointment,
} from "../repositories/appointmentRepository";
import {
  getAdherenceCounts,
  getLateMedicationLogs,
  getMedicationLogsForPatients,
  getOnOffTimeline,
  getOnOffTimelineForPatients,
  getResponsesForPatients,
  getResponsesForQuestions,
  getSevereEventLogs,
  getSevereEventLogsForPatients,
  groupByPatient,
  type AdherenceCounts,
  type WindowEnd,
} from "../repositories/dashboardRepository";
import { countUnreviewedFlagsForPatients } from "../repositories/redFlagRepository";
import { countPatients, listPatients } from "../repositories/patientProfileRepository";
import { listPrimaryForPatients } from "../repositories/patientCaregiverRepository";
import { findUsersByIds } from "../repositories/userRepository";
import type { MedicationLogRow, OnOffTimelineRow, PatientFullRow, ResponseRow } from "../types/database";

// Verified against docs/PDLIFE_Question_Bank_master_v1.xlsx — not guessed.
// (off_rate itself comes from v_onoff_timeline, which the schema's own view already pivots
// from MED_ONOFF_NOW — see dashboardRepository.getOnOffTimeline.)
const FALL_QUESTION = "MOTOR_FALL_NEAR_FALL";
const FALL_INJURY_QUESTION = "MOTOR_FALL_INJURY";
const OH_QUESTION = "AUTO_ORTHOSTATIC_SYMPTOM";

/**
 * รหัสตัวเลือกที่แปลว่า "ไม่เกิดเหตุ" — ทุกคำตอบที่ไม่ใช่ค่านี้นับเป็นเหตุการณ์หนึ่งครั้ง
 *
 * ⚠️ ค่าพวกนี้ผูกกับ options_json ในคลังคำถาม ซึ่งมาจากชีต response_options ในไฟล์ Excel
 * ถ้ามีคนแก้รหัสใน Excel แล้วไม่แก้ตรงนี้ ตัวนับจะผิดแบบเงียบๆ — ผู้ป่วยที่ตอบว่า "ไม่ได้ล้ม"
 * จะถูกนับเป็นล้มทุกคน และไม่มี error ให้เห็น มีแต่ตัวเลขบน dashboard ที่สูงเกินจริง
 * tests/dashboardCodes.test.ts ตรวจว่ารหัสเหล่านี้ยังมีอยู่จริงใน seed.sql เพื่อจับกรณีนั้น
 */
const FALL_NONE_CHOICE = "none";
const FALL_INJURY_NONE_CHOICE = "no_injury";

/** medication_logs has no documented "late" threshold (schema §11 leaves several thresholds
 *  "รอหมอ/รอ compliance ยืนยัน" — this is the same kind of open item). 30 minutes is a
 *  reasonable operational default, not a value the schema states. */
export const LATE_MED_THRESHOLD_MINUTES = 30;

// ---------- pure aggregate math (no DB — unit-testable) ----------

export function computeOffRate(timeline: Pick<OnOffTimelineRow, "state">[]): number | null {
  const definitive = timeline.filter((t) => t.state === "state_off" || t.state === "state_on");
  if (definitive.length === 0) return null;
  return definitive.filter((t) => t.state === "state_off").length / definitive.length;
}

export function computeDyskinesiaRate(timeline: Pick<OnOffTimelineRow, "dyskinesia">[]): number | null {
  const answered = timeline.filter((t) => t.dyskinesia != null);
  if (answered.length === 0) return null;
  return answered.filter((t) => t.dyskinesia !== "no").length / answered.length;
}

export function computeAdherenceRate(counts: AdherenceCounts): number | null {
  return counts.total > 0 ? counts.taken / counts.total : null;
}

/** "ยาไม่ออกฤทธิ์กี่วันติดกัน" (§9.5) — longest run of consecutive calendar days with an OFF response. */
export function longestOffStreakDays(timeline: Pick<OnOffTimelineRow, "ts" | "state">[]): number {
  const offDates = new Set(timeline.filter((t) => t.state === "state_off").map((t) => t.ts.slice(0, 10)));
  const sorted = [...offDates].sort();

  let longest = 0;
  let current = 0;
  let prevMs: number | null = null;
  for (const d of sorted) {
    const ms = new Date(`${d}T00:00:00.000Z`).getTime();
    current = prevMs !== null && ms - prevMs === 86_400_000 ? current + 1 : 1;
    longest = Math.max(longest, current);
    prevMs = ms;
  }
  return longest;
}

/**
 * คำตอบที่ถูกข้าม (skipped) ต้องไม่ถูกนับเป็นเหตุการณ์
 *
 * ตอนผู้ป่วยกดข้ามคำถาม ระบบยังบันทึกแถวลง responses แต่ answer_value เป็น {} ว่างเปล่า
 * ถ้าไม่กรองออก การเทียบ `choice !== "ไม่เกิดเหตุ"` จะเป็นจริงเสมอ (undefined ไม่เท่ากับอะไรทั้งนั้น)
 * แปลว่า "ข้ามคำถาม" กลายเป็น "เกิดเหตุ" — หมอเห็นตัวเลขล้ม/บาดเจ็บสูงเกินจริงโดยไม่มีอะไรเตือน
 */
function answered<T extends Pick<ResponseRow, "skipped">>(responses: T[]): T[] {
  return responses.filter((r) => !r.skipped);
}

type CountableResponse = Pick<ResponseRow, "answer_value" | "skipped">;

export function countFallsOrNearFalls(responses: CountableResponse[]): number {
  return answered(responses).filter((r) => r.answer_value.choice !== FALL_NONE_CHOICE).length;
}

export function countFallsWithInjury(responses: CountableResponse[]): number {
  return answered(responses).filter((r) => r.answer_value.choice !== FALL_INJURY_NONE_CHOICE).length;
}

/** §9.5: "AUT-01 ซ้ำ >=2 ครั้ง หรือหน้ามืดจะเป็นลม" — repeat count and single-severe count, separately. */
export function countOrthostaticSignals(responses: CountableResponse[]): {
  repeatCount: number;
  severeCount: number;
} {
  const scores = answered(responses).map((r) => r.answer_value.score ?? 0);
  return {
    repeatCount: scores.filter((s) => s >= 1).length,
    severeCount: scores.filter((s) => s >= 3).length,
  };
}

// ---------- window helper ----------

/**
 * ช่วงเวลาย้อนหลัง N วัน
 *
 * ไม่ส่ง endDate = ช่วงที่จบ "ตอนนี้" ซึ่งจะ **ไม่ใส่ขอบบน** ให้ query เลย (toIso = null)
 * เหตุผลอยู่ที่ WindowEnd ใน dashboardRepository — สรุปสั้น ๆ คือคอลัมน์เวลาถูกประทับด้วย
 * นาฬิกาของฐานข้อมูล แต่ขอบบนคำนวณจากนาฬิกาของเครื่องแอป พอสองนาฬิกาเหลื่อมกัน แถวที่
 * เพิ่งเขียนจะดูเหมือนอยู่ในอนาคตแล้วหายไปจากผลลัพธ์
 *
 * ส่งค่า endDate มาเมื่อเป็นช่วงเวลาในอดีตจริง ๆ (เช่น 7 วันก่อนวันนัดที่ผ่านไปแล้ว)
 * กรณีนั้นขอบบนมีความหมายและต้องมี
 *
 * displayTo ใช้แสดงในผลลัพธ์เท่านั้น ไม่ได้ใช้กรอง
 */
function windowFor(
  days: number,
  endDate?: Date
): { fromIso: string; toIso: WindowEnd; displayTo: string } {
  const to = endDate ?? new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days);
  return {
    fromIso: from.toISOString(),
    toIso: endDate === undefined ? null : to.toISOString(),
    displayTo: to.toISOString(),
  };
}

// ---------- C1: pre-visit summary ----------

export interface PreVisitSummary {
  window: { from: string; to: string };
  off_rate: number | null;
  dyskinesia_rate: number | null;
  adherence_rate: number | null;
  timeline_point_count: number;
}

async function computeSummary(
  patientId: string,
  fromIso: string,
  toIso: WindowEnd,
  displayTo: string
): Promise<PreVisitSummary> {
  const [timeline, adherence] = await Promise.all([
    getOnOffTimeline(patientId, fromIso, toIso),
    getAdherenceCounts(patientId, fromIso, toIso),
  ]);

  return {
    window: { from: fromIso, to: displayTo },
    off_rate: computeOffRate(timeline),
    dyskinesia_rate: computeDyskinesiaRate(timeline),
    adherence_rate: computeAdherenceRate(adherence),
    timeline_point_count: timeline.length,
  };
}

export async function getPreVisitSummary(
  requester: JwtPayload,
  patientId: string,
  days = 7
): Promise<PreVisitSummary> {
  await assertCanAccessPatient(requester, patientId);
  const { fromIso, toIso, displayTo } = windowFor(days);
  return computeSummary(patientId, fromIso, toIso, displayTo);
}

// ---------- C2: raw timeline for the graph ----------

export async function getTimeline(
  requester: JwtPayload,
  patientId: string,
  days = 7
): Promise<OnOffTimelineRow[]> {
  await assertCanAccessPatient(requester, patientId);
  const { fromIso, toIso } = windowFor(days);
  return getOnOffTimeline(patientId, fromIso, toIso);
}

// ---------- C3: this visit vs. the previous one ----------

export interface VisitSummary extends PreVisitSummary {
  appointment_id: string;
  visit_date: string;
}

export interface VisitComparison {
  current: VisitSummary;
  previous: VisitSummary | null;
}

export async function getVisitComparison(
  requester: JwtPayload,
  patientId: string,
  appointmentId: string
): Promise<VisitComparison> {
  await assertCanAccessPatient(requester, patientId);

  const appointment = await findAppointmentById(appointmentId);
  if (!appointment || appointment.patient_id !== patientId) {
    throw new ApiError(404, "Appointment not found");
  }

  const currentWindow = windowFor(7, new Date(`${appointment.visit_date}T23:59:59.999Z`));
  const currentSummary = await computeSummary(
    patientId,
    currentWindow.fromIso,
    currentWindow.toIso,
    currentWindow.displayTo
  );

  const previousAppt = await findPreviousCompletedAppointment(patientId, appointment.visit_date);
  let previous: VisitSummary | null = null;
  if (previousAppt) {
    const prevWindow = windowFor(7, new Date(`${previousAppt.visit_date}T23:59:59.999Z`));
    const summary = await computeSummary(
      patientId,
      prevWindow.fromIso,
      prevWindow.toIso,
      prevWindow.displayTo
    );
    previous = { ...summary, appointment_id: previousAppt.id, visit_date: previousAppt.visit_date };
  }

  return {
    current: { ...currentSummary, appointment_id: appointment.id, visit_date: appointment.visit_date },
    previous,
  };
}

// ---------- §9.5: warning-level red flags — query-only, never written to red_flags ----------

export interface WarningFlags {
  window: { from: string; to: string };
  off_streak_days: number;
  late_medication_count: number;
  fall_or_near_fall_count: number;
  fall_with_injury_count: number;
  orthostatic_repeat_count: number;
  orthostatic_severe_count: number;
  severe_event_count: number;
}

export async function getWarningFlags(
  requester: JwtPayload,
  patientId: string,
  days = 7
): Promise<WarningFlags> {
  await assertCanAccessPatient(requester, patientId);
  const { fromIso, toIso, displayTo } = windowFor(days);

  const [timeline, fallResponses, injuryResponses, ohResponses, severeEvents, lateLogs] = await Promise.all([
    getOnOffTimeline(patientId, fromIso, toIso),
    getResponsesForQuestions(patientId, [FALL_QUESTION], fromIso, toIso),
    getResponsesForQuestions(patientId, [FALL_INJURY_QUESTION], fromIso, toIso),
    getResponsesForQuestions(patientId, [OH_QUESTION], fromIso, toIso),
    getSevereEventLogs(patientId, fromIso, toIso),
    getLateMedicationLogs(patientId, fromIso, toIso, LATE_MED_THRESHOLD_MINUTES),
  ]);

  const orthostatic = countOrthostaticSignals(ohResponses);

  return {
    window: { from: fromIso, to: displayTo },
    off_streak_days: longestOffStreakDays(timeline),
    late_medication_count: lateLogs.length,
    fall_or_near_fall_count: countFallsOrNearFalls(fallResponses),
    fall_with_injury_count: countFallsWithInjury(injuryResponses),
    orthostatic_repeat_count: orthostatic.repeatCount,
    orthostatic_severe_count: orthostatic.severeCount,
    severe_event_count: severeEvents.length,
  };
}


// ---------- roster: ทะเบียนผู้ป่วยพร้อมสรุปของทุกคนในคำขอเดียว ----------

/**
 * หน้าทะเบียนของเว็บ staff เคยเรียก endpoint รายคน 3 ตัวต่อผู้ป่วยหนึ่งคน (summary +
 * warnings + red-flags) ผู้ป่วย 50 คน = 151 คำขอ ต่อการเปิดหน้าหนึ่งครั้ง ทำให้หน้าค้าง
 * อยู่ที่โครงร่างนานพอที่ผู้ใช้จะคิดว่าเมนูเสีย
 *
 * endpoint นี้ยิง query คงที่ 5 ครั้งไม่ว่าจะมีผู้ป่วยกี่คน แล้วคำนวณด้วยฟังก์ชันบริสุทธิ์
 * ชุดเดียวกับที่ endpoint รายคนใช้ — ตัวเลขบนหน้าทะเบียนกับหน้าเวชระเบียนจึงตรงกันเสมอ
 * โดยไม่ต้องพึ่งวินัยของคนเขียนโค้ด
 *
 * ยังไม่ใส่การนับ red flag ระดับ warning เพราะ §9.5 กำหนดให้ warning เป็น query-only
 */
export interface RosterEntry {
  patient: PatientFullRow;
  summary: PreVisitSummary;
  warnings: WarningFlags;
  unreviewed_flag_count: number;
  unreviewed_urgent_count: number;
  caregiver_name: string | null;
}

/** ธงค้างข้ามสัปดาห์ได้ จึงมองย้อนไกลกว่าตัวนับอาการ — ตรงกับค่าเริ่มต้นของ GET red-flags */
export const ROSTER_FLAG_WINDOW_DAYS = 30;

export function adherenceFrom(logs: MedicationLogRow[]): AdherenceCounts {
  const counted = logs.filter((l) => l.status === "taken" || l.status === "skipped");
  const taken = counted.filter((l) => l.status === "taken").length;
  return { taken, skipped: counted.length - taken, total: counted.length };
}

export async function getRoster(
  requester: JwtPayload,
  days = 7,
  limit?: number
): Promise<{
  window: { from: string; to: string };
  /** ผู้ป่วยทั้งหมดในระบบ — เทียบกับ roster.length เพื่อรู้ว่ารายการถูกตัดหรือยัง */
  total_patients: number;
  roster: RosterEntry[];
}> {
  // ทะเบียนทั้งคลินิกเป็นของ staff เท่านั้น — route ก็กันด้วย requireRole อีกชั้น
  if (requester.role !== "nurse" && requester.role !== "doctor" && requester.role !== "admin") {
    throw new ApiError(403, "Only clinic staff can read the patient roster");
  }

  const { fromIso, displayTo } = windowFor(days);
  const flagWindow = windowFor(ROSTER_FLAG_WINDOW_DAYS);

  const [patients, totalPatients] = await Promise.all([listPatients({ limit }), countPatients()]);
  const ids = patients.map((p) => p.id);

  const [timelines, fallRows, injuryRows, ohRows, severeRows, medLogs, flagRows, primaryLinks] =
    await Promise.all([
      getOnOffTimelineForPatients(ids, fromIso),
      getResponsesForPatients(ids, [FALL_QUESTION], fromIso),
      getResponsesForPatients(ids, [FALL_INJURY_QUESTION], fromIso),
      getResponsesForPatients(ids, [OH_QUESTION], fromIso),
      getSevereEventLogsForPatients(ids, fromIso),
      getMedicationLogsForPatients(ids, fromIso),
      countUnreviewedFlagsForPatients(ids, flagWindow.fromIso),
      listPrimaryForPatients(ids),
    ]);

  const byTimeline = groupByPatient(timelines, ids);
  const byFall = groupByPatient(fallRows, ids);
  const byInjury = groupByPatient(injuryRows, ids);
  const byOh = groupByPatient(ohRows, ids);
  const bySevere = groupByPatient(severeRows, ids);
  const byMedLog = groupByPatient(medLogs, ids);
  const byFlag = groupByPatient(flagRows, ids);

  // ตารางเชื่อมมีแค่ caregiver_id — ต้องไปหยิบชื่อจาก users อีกคำขอ (แค่ผู้ดูแลหลักเท่านั้น
  // ไม่ใช่ผู้ดูแลทุกคน จึงมักมีไม่กี่สิบ id ต่อคลินิก ไม่คุ้มทำเป็น view แยก)
  const caregiverUsers = await findUsersByIds([...new Set(primaryLinks.map((l) => l.caregiver_id))]);
  const caregiverNameById = new Map(
    caregiverUsers.map((u) => [u.id, `${u.first_name} ${u.last_name}`])
  );
  const primaryCaregiverIdByPatient = new Map(
    primaryLinks.map((l) => [l.patient_id, l.caregiver_id])
  );

  const roster = patients.map((patient) => {
    const timeline = byTimeline.get(patient.id) ?? [];
    const logs = byMedLog.get(patient.id) ?? [];
    const orthostatic = countOrthostaticSignals(byOh.get(patient.id) ?? []);
    const flags = byFlag.get(patient.id) ?? [];

    return {
      patient,
      summary: {
        window: { from: fromIso, to: displayTo },
        off_rate: computeOffRate(timeline),
        dyskinesia_rate: computeDyskinesiaRate(timeline),
        adherence_rate: computeAdherenceRate(adherenceFrom(logs)),
        timeline_point_count: timeline.length,
      },
      warnings: {
        window: { from: fromIso, to: displayTo },
        off_streak_days: longestOffStreakDays(timeline),
        // late_minutes เป็น null ตอนยังไม่ได้กิน — null ไม่ใช่ "ตรงเวลา" จึงต้องเช็คก่อนเทียบ
        late_medication_count: logs.filter(
          (l) => l.late_minutes !== null && l.late_minutes > LATE_MED_THRESHOLD_MINUTES
        ).length,
        fall_or_near_fall_count: countFallsOrNearFalls(byFall.get(patient.id) ?? []),
        fall_with_injury_count: countFallsWithInjury(byInjury.get(patient.id) ?? []),
        orthostatic_repeat_count: orthostatic.repeatCount,
        orthostatic_severe_count: orthostatic.severeCount,
        severe_event_count: (bySevere.get(patient.id) ?? []).length,
      },
      unreviewed_flag_count: flags.length,
      unreviewed_urgent_count: flags.filter((f) => f.severity === "urgent").length,
      caregiver_name:
        caregiverNameById.get(primaryCaregiverIdByPatient.get(patient.id) ?? "") ?? null,
    };
  });

  return { window: { from: fromIso, to: displayTo }, total_patients: totalPatients, roster };
}
