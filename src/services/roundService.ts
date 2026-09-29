import { ApiError } from "../utils/ApiError";
import type { JwtPayload } from "../utils/jwt";
import { assertCanAccessPatient } from "./patientAccessService";
import {
  createRound,
  findRoundById,
  listByPatient,
  markCompleted,
  touchSync,
  type CreateRoundInput,
} from "../repositories/roundInstanceRepository";
import {
  findTemplate,
  listTemplateQuestions,
  listTemplateQuestionsForCodes,
  type TemplateQuestionWithBank,
} from "../repositories/questionBankRepository";
import { listByRound, listByRounds } from "../repositories/responseRepository";
import { getVisibleQuestions, type ResponseMap } from "./flowEngineService";
import type { RoundInstanceRow } from "../types/database";

/** The one template patients/caregivers create on demand — schema §9.1: "ไม่มีหน้าต่าง". */
const ADHOC_TEMPLATE_CODE = "ADHOC_CONCERN";

export async function createAdhocRound(
  requester: JwtPayload,
  patientId: string
): Promise<RoundInstanceRow> {
  await assertCanAccessPatient(requester, patientId, { requireAnswerPermission: true });

  const template = await findTemplate(ADHOC_TEMPLATE_CODE);
  if (!template || !template.active) {
    throw new ApiError(500, "ADHOC_CONCERN template is not configured");
  }

  const input: CreateRoundInput = {
    patient_id: patientId,
    template_code: ADHOC_TEMPLATE_CODE,
    scheduled_at: new Date().toISOString(),
  };
  return createRound(input);
}

export async function getRound(requester: JwtPayload, roundId: string): Promise<RoundInstanceRow> {
  const round = await findRoundById(roundId);
  if (!round) throw new ApiError(404, "Round not found");
  await assertCanAccessPatient(requester, round.patient_id);
  return round;
}

export async function listRoundsForPatient(
  requester: JwtPayload,
  patientId: string,
  status?: RoundInstanceRow["status"],
  activityDate?: string,
  actionableAt?: string
): Promise<RoundInstanceRow[]> {
  await assertCanAccessPatient(requester, patientId);
  return collapseDuplicateRounds(await listByPatient(patientId, { status, activityDate, actionableAt }));
}

function logicalRoundKey(round: RoundInstanceRow): string {
  if (round.template_code === "POST_MED_MICRO") return `post:${round.medication_log_id ?? round.id}`;
  if (round.template_code === "PRE_NEXT_MED_MICRO") return `pre-next:${round.target_dose_at ?? round.id}`;
  if (round.template_code === "PREVISIT_7D_FORM") return `previsit:${round.appointment_id ?? round.id}`;
  if (["MORNING_CHECKIN", "EVENING_DAILY_CORE", "WEEKLY_CHECKIN"].includes(round.template_code)) {
    return `${round.template_code}:${round.activity_date}`;
  }
  return round.id;
}

const STATUS_PRIORITY: Record<RoundInstanceRow["status"], number> = {
  completed: 4,
  pending: 3,
  expired: 2,
  missed: 1,
};

/** Hides historical scheduler duplicates without deleting clinical responses from the database. */
export function collapseDuplicateRounds(rounds: RoundInstanceRow[]): RoundInstanceRow[] {
  const chosen = new Map<string, RoundInstanceRow>();
  for (const round of rounds) {
    const key = logicalRoundKey(round);
    const current = chosen.get(key);
    if (!current || STATUS_PRIORITY[round.status] > STATUS_PRIORITY[current.status]) chosen.set(key, round);
  }
  return [...chosen.values()].sort((a, b) => b.available_at.localeCompare(a.available_at));
}

/** Progress for the list view without one mobile HTTP request per round. */
export async function remainingQuestionsForRounds(rounds: RoundInstanceRow[]): Promise<Map<string, number>> {
  const pending = rounds.filter((round) => round.status === "pending");
  const result = new Map(rounds.map((round) => [round.id, 0]));
  if (pending.length === 0) return result;

  const [templateQuestions, responses] = await Promise.all([
    listTemplateQuestionsForCodes([...new Set(pending.map((round) => round.template_code))]),
    listByRounds(pending.map((round) => round.id)),
  ]);
  const questionsByTemplate = new Map<string, TemplateQuestionWithBank[]>();
  for (const question of templateQuestions) {
    const group = questionsByTemplate.get(question.template_code) ?? [];
    group.push(question);
    questionsByTemplate.set(question.template_code, group);
  }
  const answersByRound = new Map<string, ResponseMap>();
  for (const response of responses) {
    const answers = answersByRound.get(response.round_instance_id) ?? new Map();
    answers.set(response.question_code, {
      answer_value: response.answer_value,
      skipped: response.skipped,
    });
    answersByRound.set(response.round_instance_id, answers);
  }
  for (const round of pending) {
    const answers = answersByRound.get(round.id) ?? new Map();
    const visible = getVisibleQuestions(questionsByTemplate.get(round.template_code) ?? [], answers);
    result.set(round.id, visible.filter((question) => !answers.has(question.question_code)).length);
  }
  return result;
}

async function buildResponseMap(roundId: string): Promise<ResponseMap> {
  const responses = await listByRound(roundId);
  const map: ResponseMap = new Map();
  for (const r of responses) {
    map.set(r.question_code, { answer_value: r.answer_value, skipped: r.skipped });
  }
  return map;
}

export interface RoundQuestionsResult {
  round: RoundInstanceRow;
  questions: TemplateQuestionWithBank[];
  answered: ResponseMap;
}

export async function getRoundQuestions(
  requester: JwtPayload,
  roundId: string
): Promise<RoundQuestionsResult> {
  const round = await getRound(requester, roundId);
  const templateQuestions = await listTemplateQuestions(round.template_code);
  const answered = await buildResponseMap(roundId);
  const visible = getVisibleQuestions(templateQuestions, answered);
  return { round, questions: visible, answered };
}

/** Round-level offline sync (schema §1.1) — called on every response write, not just completion. */
export async function recordSync(roundId: string, submittedAt?: string): Promise<void> {
  await touchSync(roundId, submittedAt);
}

/** §9.3: pending -> completed once every required, currently-visible question has a response. */
export async function tryCompleteRound(
  round: RoundInstanceRow,
  answeredBy: string
): Promise<RoundInstanceRow> {
  const templateQuestions = await listTemplateQuestions(round.template_code);
  const answered = await buildResponseMap(round.id);
  const visible = getVisibleQuestions(templateQuestions, answered);

  const allRequiredAnswered = visible.filter((tq) => tq.required).every((tq) => answered.has(tq.question_code));

  if (!allRequiredAnswered) return round;
  return markCompleted(round.id, answeredBy);
}
