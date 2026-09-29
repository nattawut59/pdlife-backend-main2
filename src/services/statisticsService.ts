import type { JwtPayload } from "../utils/jwt";
import type { MedicationLogRow, OnOffTimelineRow } from "../types/database";
import { assertCanAccessPatient } from "./patientAccessService";
import { getOnOffTimeline } from "../repositories/dashboardRepository";
import { listByPatientInRange, listByPatientAndActivityDate } from "../repositories/medicationLogRepository";
import { computeAdherenceRate, computeDyskinesiaRate, computeOffRate } from "./dashboardService";

const TIME_ZONE = "Asia/Bangkok";

function dateKey(value: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function bangkokDayStartIso(date: string): string {
  return new Date(`${date}T00:00:00+07:00`).toISOString();
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export interface DailyStatisticsPoint {
  date: string;
  adherence_rate: number | null;
  off_rate: number | null;
  dyskinesia_rate: number | null;
  doses_taken: number | null;
}

export function aggregateDailyStatistics(
  days: number,
  today: string,
  timeline: OnOffTimelineRow[],
  logs: MedicationLogRow[]
) {
  const firstDate = addDays(today, -(days - 1));
  const dates = Array.from({ length: days }, (_, index) => addDays(firstDate, index));
  const timelineByDate = new Map<string, OnOffTimelineRow[]>();
  const logsByDate = new Map<string, MedicationLogRow[]>();
  for (const row of timeline) timelineByDate.set(dateKey(row.ts), [...(timelineByDate.get(dateKey(row.ts)) ?? []), row]);
  for (const row of logs) logsByDate.set(dateKey(row.planned_at), [...(logsByDate.get(dateKey(row.planned_at)) ?? []), row]);

  const daily: DailyStatisticsPoint[] = dates.map((date) => {
    const dayTimeline = timelineByDate.get(date) ?? [];
    const decidedLogs = (logsByDate.get(date) ?? []).filter((row) => row.status !== "pending");
    const taken = decidedLogs.filter((row) => row.status === "taken").length;
    return {
      date,
      adherence_rate: decidedLogs.length ? taken / decidedLogs.length : null,
      off_rate: computeOffRate(dayTimeline),
      dyskinesia_rate: computeDyskinesiaRate(dayTimeline),
      doses_taken: decidedLogs.length ? taken : null,
    };
  });

  const decidedLogs = logs.filter((row) => row.status !== "pending");
  let streak = 0;
  for (let index = daily.length - 1; index >= 0; index -= 1) {
    const point = daily[index];
    if (point.adherence_rate == null && point.off_rate == null && point.dyskinesia_rate == null) break;
    streak += 1;
  }

  return {
    range_days: days,
    adherence_rate: computeAdherenceRate({
      taken: decidedLogs.filter((row) => row.status === "taken").length,
      skipped: decidedLogs.filter((row) => row.status === "skipped").length,
      total: decidedLogs.length,
    }),
    off_rate: computeOffRate(timeline),
    dyskinesia_rate: computeDyskinesiaRate(timeline),
    streak_days_logged: streak,
    daily,
  };
}

export async function getStatistics(requester: JwtPayload, patientId: string, days: number) {
  await assertCanAccessPatient(requester, patientId);
  const today = dateKey(new Date());
  const firstDate = addDays(today, -(days - 1));
  const endDate = addDays(today, 1);
  const fromIso = bangkokDayStartIso(firstDate);
  const toIso = bangkokDayStartIso(endDate);
  const [timeline, logs] = await Promise.all([
    getOnOffTimeline(patientId, fromIso, toIso),
    listByPatientInRange(patientId, fromIso, toIso),
  ]);
  return aggregateDailyStatistics(days, today, timeline, logs);
}

function bangkokTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export async function getDailyFluctuation(requester: JwtPayload, patientId: string, date: string) {
  await assertCanAccessPatient(requester, patientId);
  const fromIso = bangkokDayStartIso(date);
  const toIso = bangkokDayStartIso(addDays(date, 1));
  const [timeline, logs] = await Promise.all([
    getOnOffTimeline(patientId, fromIso, toIso),
    listByPatientAndActivityDate(patientId, date),
  ]);

  const evaluations = timeline.flatMap((row) => {
    const state = row.dyskinesia && row.dyskinesia !== "no"
      ? "DYSKINESIA"
      : row.state === "state_off"
        ? "OFF"
        : row.state === "state_on"
          ? "ON"
          : null;
    if (!state) return [];
    return [{
      time: bangkokTime(row.ts),
      state,
      score: state === "DYSKINESIA" ? 2 : state === "ON" ? 0 : -2,
      type: row.template_code === "POST_MED_MICRO" ? "post_dose_45min" : "wearing_off_manual",
    }];
  });

  return {
    date,
    medications: logs.map((log) => ({
      time: bangkokTime(log.taken_at ?? log.planned_at),
      doseName: "มื้อยา",
      status: log.status,
    })),
    evaluations,
    missedSlots: [],
  };
}
