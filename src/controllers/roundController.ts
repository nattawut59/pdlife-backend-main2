import type { Request, Response } from "express";
import * as roundService from "../services/roundService";
import { ApiError } from "../utils/ApiError";
import type { RoundStatus } from "../config/constants";

function requireUser(req: Request) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  return req.user;
}

export async function createAdhoc(req: Request, res: Response) {
  const user = requireUser(req);
  const round = await roundService.createAdhocRound(user, req.body.patient_id);
  res.locals.auditTargetId = round.id;
  res.locals.auditNewValue = round;
  res.status(201).json({ round });
}

export async function getOne(req: Request, res: Response) {
  const user = requireUser(req);
  const round = await roundService.getRound(user, req.params.id);
  res.json({ round });
}

export async function getQuestions(req: Request, res: Response) {
  const user = requireUser(req);
  const result = await roundService.getRoundQuestions(user, req.params.id);
  res.json({
    round: result.round,
    questions: result.questions.map((tq) => ({
      question_code: tq.question_code,
      sort_order: tq.sort_order,
      required: tq.required,
      ui_note_th: tq.ui_note_th,
      question: tq.question_bank,
      answered: result.answered.has(tq.question_code),
    })),
  });
}

export async function listForPatient(req: Request, res: Response) {
  const user = requireUser(req);
  const status = req.query.status as RoundStatus | undefined;
  const rounds = await roundService.listRoundsForPatient(
    user,
    req.params.patientId,
    status,
    req.query.activity_date as string | undefined,
    req.query.actionable_at as string | undefined
  );
  if (req.query.include_progress === "true") {
    const remaining = await roundService.remainingQuestionsForRounds(rounds);
    res.json({ rounds: rounds.map((round) => ({ ...round, questions_remaining: remaining.get(round.id) ?? 0 })) });
    return;
  }
  res.json({ rounds });
}
