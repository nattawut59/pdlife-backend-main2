import {
  createRoundIfAbsent,
  listStalePending,
  markExpired,
  markMissed,
} from "../repositories/roundInstanceRepository";
import {
  createPendingLogIfAbsent,
  findRecentlyPlanned,
} from "../repositories/medicationLogRepository";
import { listAllActive as listAllActivePrescriptions } from "../repositories/patientMedicationRepository";
import { findMedicationsByIds } from "../repositories/medicationRepository";
import { listUpcoming as listUpcomingAppointments } from "../repositories/appointmentRepository";
import { findManyByUserIds } from "../repositories/patientProfileRepository";
import { listByRound } from "../repositories/responseRepository";
import { notify } from "./notificationService";
import { existsForAppointmentAndType } from "../repositories/notificationRepository";
import type { NotifType } from "../config/constants";
import {
  addMinutes,
  dateOnly,
  endOfDay,
  endOfAppDate,
  isWithin,
  todayAt,
} from "../utils/datetime";
import { mapWithConcurrency } from "../utils/concurrency";
import type {
  AppointmentRow,
  PatientMedicationRow,
  PatientProfileRow,
} from "../types/database";

const EMA_WINDOW_DAYS = 7;

/** How far before the next dose PRE_NEXT_MED_MICRO opens — the one window §9.1 states explicitly. */
const NEXT_DOSE_LEAD_MINUTES = 30;

/**
 * จำนวนโดสที่ประมวลผลพร้อมกันสูงสุดต่อรอบ tick — คนไข้จำนวนมากมักกินยาเวลาใกล้เคียงกัน (เช่น
 * มื้อเช้าพร้อมกันหมด) ถ้ายิงทีละคน (for...of + await) tick เดียวอาจกินเวลานานกว่า 1 นาทีที่
 * รอบถัดไปจะมาถึง ทำให้แจ้งเตือนกินยาช้าลงเรื่อยๆ ตามจำนวนคนไข้ (ดู mapWithConcurrency)
 * ค่านี้เป็นการประมาณที่สมเหตุสมผล ยังไม่เคยวัด load จริง ปรับได้ถ้าเจอปัญหาจริงตอนใช้งาน
 */
const REMINDER_DISPATCH_CONCURRENCY = 25;

// Cron runs once per minute. Allow one extra minute for queue/DB jitter, but
// never send an old "due now" push after a process restart hours later.
const NOTIFICATION_DISPATCH_LAG_MS = 2 * 60_000;

export function shouldNotifyAt(dueAt: Date, now: Date): boolean {
  const lag = now.getTime() - dueAt.getTime();
  return lag >= 0 && lag < NOTIFICATION_DISPATCH_LAG_MS;
}

export function daysUntilAppointment(visitDate: string, now: Date): number {
  const today = dateOnly(now);
  return Math.round(
    (Date.parse(`${visitDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

export async function generateAppointmentReminders(now = new Date()): Promise<void> {
  const appointments = await listUpcomingAppointments(2, now);
  await mapWithConcurrency(appointments, REMINDER_DISPATCH_CONCURRENCY, async (appointment) => {
    const days = daysUntilAppointment(appointment.visit_date, now);
    if (days !== 1 && days !== 2) return;
    const type: NotifType = days === 1 ? "reminder_1day" : "reminder_2days";
    if (await existsForAppointmentAndType(appointment.id, type)) return;
    await notify({
      patientId: appointment.patient_id,
      appointmentId: appointment.id,
      type,
      title: days === 1 ? "พรุ่งนี้มีนัดพบแพทย์" : "อีก 2 วันมีนัดพบแพทย์",
      body: appointment.visit_time
        ? `เวลานัด ${appointment.visit_time.slice(0, 5)} น. กรุณาเตรียมข้อมูลยาและอาการ`
        : "กรุณาเตรียมข้อมูลยาและอาการก่อนพบแพทย์",
      data: { type, appointment_id: appointment.id },
    });
  });
}

function isPrescriptionActiveOn(rx: PatientMedicationRow, now: Date): boolean {
  if (!rx.active) return false;
  const today = dateOnly(now);
  if (rx.start_date > today) return false;
  if (rx.end_date && rx.end_date < today) return false;
  return true;
}

// ---------- medication reminders (§9.6 — always on, independent of the EMA window) ----------

interface DueDose {
  prescription: PatientMedicationRow;
  plannedAt: Date;
  /** คีย์เวลาตามที่อยู่ใน scheduled_times — ใช้เปิดหา doses ของมื้อนั้น */
  time: string;
}

/**
 * ขนาดยาของมื้อนั้นจาก doses
 *
 * ต้องเผื่อรูปแบบเวลาสองแบบ: คอลัมน์ TIME[] ของ Postgres ส่งกลับมาเป็น "HH:MM:SS" เสมอ
 * ไม่ว่าจะ insert แบบไหน แต่ doses เป็น JSON ที่ฝั่งเว็บเป็นคนตั้งคีย์ จึงมีทั้งที่เป็น "08:00"
 * และ "08:00:00" ปนกันตามยุคที่บันทึก — ถ้าเปิดหาด้วยคีย์เดียวจะได้ null ในใบสั่งยาครึ่งหนึ่ง
 * แล้วแจ้งเตือนจะไม่บอกขนาดยาโดยไม่มีใครรู้ว่าทำไม
 */
export function doseForTime(doses: Record<string, string>, time: string): string | null {
  const short = time.slice(0, 5);
  return doses[time] ?? doses[short] ?? doses[`${short}:00`] ?? null;
}

/**
 * ข้อความแจ้งเตือนกินยา — บอกให้ได้ว่า "ยาอะไร เท่าไร"
 *
 * เดิมส่งข้อความเดียวกันหมดทุกตัวยา ผู้ป่วยที่กินยา 4 ตัว 8 มื้อต่อวันจึงได้แจ้งเตือนหน้าตา
 * เหมือนกันเป๊ะทั้งวัน แยกไม่ออกว่าอันไหนของยาตัวไหน และถ้าพลาดไปหนึ่งอันก็ไม่รู้ว่าพลาดอะไร
 *
 * ยาที่หาไม่เจอใน catalog (ถูกลบไปแล้ว) ยังต้องแจ้งเตือนได้ตามปกติ — คนไข้ไม่ควรพลาดยาเพราะ
 * ข้อมูลฝั่งเราหาย จึงถอยกลับไปใช้ข้อความเดิมแทนการข้ามหรือโยน error
 */
export function composeMedicationReminder(
  medication: { drug_name: string; drug_thai_name: string | null } | null,
  dose: string | null,
): { title: string; body: string } {
  if (!medication) {
    return { title: "ถึงเวลากินยา", body: "ถึงเวลากินยาแล้ว กดยืนยันเมื่อกินยาเสร็จ" };
  }

  // ชื่อไทยก่อนเสมอถ้ามี — ผู้ป่วยสูงอายุอ่านชื่อสามัญภาษาอังกฤษไม่ออก
  const name = medication.drug_thai_name?.trim() || medication.drug_name;
  const confirm = "กดยืนยันเมื่อกินยาเสร็จ";

  return {
    title: `ถึงเวลากินยา ${name}`,
    body: dose ? `${dose} · ${confirm}` : confirm,
  };
}

export async function generateMedicationReminders(
  now = new Date(),
): Promise<void> {
  const prescriptions = await listAllActivePrescriptions();

  const dueDoses: DueDose[] = [];
  for (const rx of prescriptions) {
    if (!isPrescriptionActiveOn(rx, now)) continue;
    for (const time of rx.scheduled_times) {
      const plannedAt = todayAt(time, now);
      if (plannedAt.getTime() > now.getTime()) continue; // not due yet
      dueDoses.push({ prescription: rx, plannedAt, time });
    }
  }

  // ดึงชื่อยาครั้งเดียวสำหรับทั้ง tick — หลายโดสมักเป็นยาตัวเดียวกัน และ tick หนึ่งมีได้หลายสิบโดส
  const medications = await findMedicationsByIds([
    ...new Set(dueDoses.filter((d) => shouldNotifyAt(d.plannedAt, now)).map((d) => d.prescription.medication_id)),
  ]);
  const medicationById = new Map(medications.map((m) => [m.id, m]));

  // แต่ละโดสเป็นคนละแถวเสมอ (prescription+เวลาคนละคู่) ยิงพร้อมกันได้โดยไม่ชนกันเอง —
  // ดู REMINDER_DISPATCH_CONCURRENCY ด้านบนสำหรับเหตุผลที่ต้องจำกัดจำนวนพร้อมกัน
  await mapWithConcurrency(
    dueDoses,
    REMINDER_DISPATCH_CONCURRENCY,
    async ({ prescription: rx, plannedAt, time }) => {
      const created = await createPendingLogIfAbsent({
        patient_id: rx.patient_id,
        prescription_id: rx.prescription_id,
        planned_at: plannedAt.toISOString(),
        activity_date: dateOnly(plannedAt),
        idempotency_key: `med:${rx.prescription_id}:${plannedAt.toISOString()}`,
      });
      if (!created) return;
      if (!shouldNotifyAt(plannedAt, now)) return;

      const medication = medicationById.get(rx.medication_id) ?? null;
      const dose = doseForTime(rx.doses, time);

      await notify({
        patientId: rx.patient_id,
        type: "medication_reminder",
        ...composeMedicationReminder(medication, dose),
        prescriptionId: rx.prescription_id,
        medicationLogId: created.id,
        data: {
          type: "medication_reminder",
          prescription_id: rx.prescription_id,
          medication_id: rx.medication_id,
          drug_name: medication?.drug_name ?? null,
          drug_thai_name: medication?.drug_thai_name ?? null,
          dose,
          planned_at: plannedAt.toISOString(),
          medication_log_id: created.id,
        },
      });
    },
  );
}

// ---------- POST_MED_MICRO / PRE_NEXT_MED_MICRO (§9.1 table) ----------

export async function generatePostMedRounds(now = new Date()): Promise<void> {
  // ตารางยา (planned_at) เป็น source of truth ไม่ใช่เวลาที่ผู้ใช้เปิดแอปมากด
  // "ทานแล้ว" รอบคำถามจึงเกิดตรงเวลาแม้ยังไม่ได้กดบันทึกการทานยา
  const recentlyPlanned = await findRecentlyPlanned(90, now); // covers the 30-60min window with margin

  // แต่ละแถวเป็นคนละ medication_log_id เสมอ ยิงพร้อมกันได้โดยไม่ชนกันเอง — เหตุผลเดียวกับ
  // generateMedicationReminders (ดู REMINDER_DISPATCH_CONCURRENCY ด้านบน)
  await mapWithConcurrency(
    recentlyPlanned,
    REMINDER_DISPATCH_CONCURRENCY,
    async (log) => {
      const plannedAt = new Date(log.planned_at);
      const windowStart = addMinutes(plannedAt, 30);
      const windowEnd = addMinutes(plannedAt, 60);
      if (!isWithin(now, windowStart, windowEnd)) return;

      const created = await createRoundIfAbsent({
        patient_id: log.patient_id,
        template_code: "POST_MED_MICRO",
        prescription_id: log.prescription_id,
        medication_log_id: log.id,
        target_dose_at: log.planned_at,
        scheduled_at: windowStart.toISOString(),
        activity_date: dateOnly(windowStart),
        available_at: windowStart.toISOString(),
        due_at: windowStart.toISOString(),
        expires_at: windowEnd.toISOString(),
        idempotency_key: `round:post-med:${log.id}`,
      });
      if (!created) return;
      if (!shouldNotifyAt(windowStart, now)) return;

      await notify({
        patientId: log.patient_id,
        type: "round_reminder",
        title: "ยาออกฤทธิ์ดีไหม",
        body: "ขอเช็คสั้น ๆ ตอนนี้ยาออกฤทธิ์ดีไหม",
        medicationLogId: log.id,
        prescriptionId: log.prescription_id,
        roundInstanceId: created.id,
        data: { type: "round_reminder", round_id: created.id, template_code: "POST_MED_MICRO" },
      });
    },
  );
}

/** One patient-level PRE_NEXT_MED round per next-dose timestamp, even when prescriptions collide. */
export async function generatePreNextMedRounds(now = new Date()): Promise<void> {
  const prescriptions = await listAllActivePrescriptions();
  const dueByPatientAndTime = new Map<string, { rx: PatientMedicationRow; nextDoseAt: Date; windowStart: Date }>();
  for (const rx of prescriptions) {
    if (!isPrescriptionActiveOn(rx, now)) continue;
    const times = [...rx.scheduled_times].sort();
    for (let i = 0; i < times.length - 1; i++) {
      const nextDoseAt = todayAt(times[i + 1], now);
      const windowStart = addMinutes(nextDoseAt, -NEXT_DOSE_LEAD_MINUTES);
      if (!isWithin(now, windowStart, nextDoseAt)) continue;
      // The question is patient-level. Multiple prescriptions due together must not create copies.
      const key = `${rx.patient_id}:${nextDoseAt.toISOString()}`;
      if (!dueByPatientAndTime.has(key)) dueByPatientAndTime.set(key, { rx, nextDoseAt, windowStart });
    }
  }

  await mapWithConcurrency(
    [...dueByPatientAndTime.values()],
    REMINDER_DISPATCH_CONCURRENCY,
    async ({ rx, nextDoseAt, windowStart }) => {
        const created = await createRoundIfAbsent({
          patient_id: rx.patient_id,
          template_code: "PRE_NEXT_MED_MICRO",
          prescription_id: rx.prescription_id,
          target_dose_at: nextDoseAt.toISOString(),
          scheduled_at: windowStart.toISOString(),
          activity_date: dateOnly(nextDoseAt),
          available_at: windowStart.toISOString(),
          due_at: nextDoseAt.toISOString(),
          expires_at: nextDoseAt.toISOString(),
          idempotency_key: `round:pre-next:${rx.patient_id}:${nextDoseAt.toISOString()}`,
        });
        if (!created) return;
        if (!shouldNotifyAt(windowStart, now)) return;

        await notify({
          patientId: rx.patient_id,
          type: "round_reminder",
          title: "เช็คอาการก่อนกินยามื้อถัดไป",
          body: "ก่อนถึงเวลากินยามื้อต่อไป อาการเริ่มกลับมาไหม",
          prescriptionId: rx.prescription_id,
          roundInstanceId: created.id,
          data: { type: "round_reminder", round_id: created.id, template_code: "PRE_NEXT_MED_MICRO" },
        });
    },
  );
}

// ---------- daily / weekly / previsit rounds — gated by the 7-day EMA window (§9.1) ----------

async function maybeCreateMorningRound(
  profile: PatientProfileRow,
  now: Date,
): Promise<void> {
  const wakeAt = todayAt(profile.wake_time, now);
  const expiresAt = addMinutes(wakeAt, 120);
  if (!isWithin(now, wakeAt, expiresAt)) return;

  const activityDate = dateOnly(wakeAt);
  const created = await createRoundIfAbsent({
    patient_id: profile.user_id,
    template_code: "MORNING_CHECKIN",
    scheduled_at: wakeAt.toISOString(),
    activity_date: activityDate,
    available_at: wakeAt.toISOString(),
    due_at: wakeAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    idempotency_key: `round:morning:${profile.user_id}:${activityDate}`,
  });
  if (!created) return;
  if (!shouldNotifyAt(wakeAt, now)) return;
  await notify({
    patientId: profile.user_id,
    type: "round_reminder",
    title: "เช็คอาการตอนเช้า",
    body: "เช้านี้ขอเช็คอาการและการนอนสั้น ๆ",
    roundInstanceId: created.id,
    data: { type: "round_reminder", round_id: created.id, template_code: "MORNING_CHECKIN" },
  });
}

async function maybeCreateEveningRound(
  profile: PatientProfileRow,
  now: Date,
): Promise<void> {
  const sleepAt = todayAt(profile.sleep_time, now);
  const startsAt = addMinutes(sleepAt, -60);
  const expiresAt = endOfDay(now);
  if (!isWithin(now, startsAt, expiresAt)) return;

  const activityDate = dateOnly(startsAt);
  const created = await createRoundIfAbsent({
    patient_id: profile.user_id,
    template_code: "EVENING_DAILY_CORE",
    scheduled_at: startsAt.toISOString(),
    activity_date: activityDate,
    available_at: startsAt.toISOString(),
    due_at: sleepAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    idempotency_key: `round:evening:${profile.user_id}:${activityDate}`,
  });
  if (!created) return;
  if (!shouldNotifyAt(startsAt, now)) return;
  await notify({
    patientId: profile.user_id,
    type: "round_reminder",
    title: "สรุปอาการวันนี้",
    body: "สรุปอาการวันนี้ เพื่อช่วยให้หมอเห็นภาพชัดขึ้น",
    roundInstanceId: created.id,
    data: { type: "round_reminder", round_id: created.id, template_code: "EVENING_DAILY_CORE" },
  });
}

async function maybeCreatePrevisitRound(
  appt: AppointmentRow,
  now: Date,
): Promise<void> {
  const activityDate = dateOnly(now);
  const created = await createRoundIfAbsent({
    patient_id: appt.patient_id,
    template_code: "PREVISIT_7D_FORM",
    appointment_id: appt.id,
    scheduled_at: now.toISOString(),
    activity_date: activityDate,
    available_at: now.toISOString(),
    expires_at: endOfAppDate(appt.visit_date).toISOString(),
    idempotency_key: `round:previsit:${appt.id}`,
  });
  if (!created) return;
  await notify({
    patientId: appt.patient_id,
    type: "previsit_reminder",
    title: "แบบสอบถามก่อนพบแพทย์",
    body: "ก่อนถึงวันนัด ขอให้ช่วยตอบแบบสอบถามอาการช่วง 7 วันที่ผ่านมา",
    appointmentId: appt.id,
    roundInstanceId: created.id,
    data: { type: "previsit_reminder", appointment_id: appt.id, round_id: created.id, template_code: "PREVISIT_7D_FORM" },
  });
}

export async function generateDailyAndWeeklyRounds(
  now = new Date(),
): Promise<void> {
  const appointments = await listUpcomingAppointments(EMA_WINDOW_DAYS, now);
  const patientIds = [...new Set(appointments.map((a) => a.patient_id))];
  if (patientIds.length === 0) return;

  const profiles = await findManyByUserIds(patientIds);

  // ยิงพร้อมกันระดับ "หนึ่งคนไข้" — รอบเช้าและเย็นของคนเดียวกันยังรันเรียงกัน
  // เพราะต้นทุนต่ำอยู่แล้ว ตัวที่ทำให้ tick ช้าคือจำนวนคนไข้ ไม่ใช่จำนวนรอบต่อคน
  await mapWithConcurrency(
    profiles,
    REMINDER_DISPATCH_CONCURRENCY,
    async (profile) => {
      await maybeCreateMorningRound(profile, now);
      await maybeCreateEveningRound(profile, now);
    },
  );

  await mapWithConcurrency(
    appointments,
    REMINDER_DISPATCH_CONCURRENCY,
    (appt) => maybeCreatePrevisitRound(appt, now),
  );
}

// ---------- sweep (§9.3) ----------

/** pending -> missed (no responses at all) or expired (partial responses kept, per schema §9.3). */
export async function sweepStaleRounds(): Promise<void> {
  const stale = await listStalePending();
  for (const round of stale) {
    const responses = await listByRound(round.id);
    if (responses.length === 0) {
      await markMissed(round.id);
    } else {
      await markExpired(round.id);
    }
  }
}

export async function runSchedulerTick(now = new Date()): Promise<void> {
  await generateMedicationReminders(now);
  await generateAppointmentReminders(now);
  await generatePreNextMedRounds(now);
  await generatePostMedRounds(now);
  await generateDailyAndWeeklyRounds(now);
  await sweepStaleRounds();
}
