import { ApiError } from "../utils/ApiError";
import type { JwtPayload } from "../utils/jwt";
import { assertCanAccessPatient } from "./patientAccessService";
import { findQuestionByCode } from "../repositories/questionBankRepository";
import { listByRound, upsertResponse } from "../repositories/responseRepository";
import * as roundService from "./roundService";
import { validateAndNormalizeAnswer } from "./flowEngineService";
import {
  checkFallNearFallRule,
  checkMoodSafetyGate,
  checkOrthostaticPairedWithFall,
  checkStructuredRedFlagRule,
  raiseRedFlag,
} from "./redFlagService";
import type { ResponseRow } from "../types/database";

export interface SubmitResponseInput {
  answer_value?: Record<string, unknown>;
  skipped?: boolean;
  submitted_at?: string;
}

export async function submitResponse(
  requester: JwtPayload,
  roundId: string,
  questionCode: string,
  input: SubmitResponseInput
): Promise<ResponseRow> {
  const round = await roundService.getRound(requester, roundId);

  // missed/expired หมายถึงตอบช้ากว่าเวลาแผน ไม่ได้หมายถึงหมดสิทธิ์ตอบ ผู้ใช้
  // ยังบันทึกย้อนหลังได้ และ answered_at/submitted_at จะสะท้อนเวลาที่ตอบจริง
  if (round.status === "completed") {
    throw new ApiError(409, `Cannot answer a ${round.status} round`);
  }

  await assertCanAccessPatient(requester, round.patient_id, { requireAnswerPermission: true });

  if (requester.role !== "patient" && requester.role !== "caregiver") {
    throw new ApiError(403, "Only patients or caregivers can submit diary responses");
  }
  const answeredByRole = requester.role;

  const question = await findQuestionByCode(questionCode);
  if (!question || !question.active) {
    throw new ApiError(400, `Unknown or inactive question_code: ${questionCode}`);
  }

  // §2 respondent policy — MOOD-04 (patient_only) must never be recorded as a caregiver answer.
  if (question.respondent === "patient_only" && answeredByRole === "caregiver") {
    throw new ApiError(400, `${questionCode} can only be answered by the patient`);
  }

  const skipped = input.skipped ?? false;
  const answerValue = validateAndNormalizeAnswer(question, input.answer_value, skipped);

  const response = await upsertResponse({
    patient_id: round.patient_id,
    round_instance_id: round.id,
    question_code: questionCode,
    question_version: question.version,
    answer_value: answerValue,
    skipped,
    answered_by_role: answeredByRole,
  });

  let trigger =
    checkMoodSafetyGate(question, answerValue, skipped) ??
    checkFallNearFallRule(question, answerValue) ??
    checkStructuredRedFlagRule(question, answerValue);

  // ดึงคำตอบพี่น้องเฉพาะตอนจำเป็น (คำถามนี้ + ยังไม่มี trigger จากกติกาอื่น) กันคำขอ DB เกิน
  // จำเป็นสำหรับคำถามอีก ~40 ข้อที่ไม่เกี่ยวกับ MOT-05/AUT-01 เลย
  if (!trigger && questionCode === "AUTO_ORTHOSTATIC_SYMPTOM") {
    const siblingResponses = await listByRound(round.id);
    trigger = checkOrthostaticPairedWithFall(question, siblingResponses);
  }

  if (trigger) {
    await raiseRedFlag(round.patient_id, response.id, questionCode, trigger);
  }

  await roundService.recordSync(round.id, input.submitted_at);
  await roundService.tryCompleteRound(round, requester.sub);

  return response;
}
