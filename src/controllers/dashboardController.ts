import type { Request, Response } from "express";
import * as dashboardService from "../services/dashboardService";
import * as appAssessmentService from "../services/appAssessmentService";
import { ApiError } from "../utils/ApiError";

function requireUser(req: Request) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  return req.user;
}

function parseDays(req: Request): number | undefined {
  return req.query.days ? Number(req.query.days) : undefined;
}

export async function getTimeline(req: Request, res: Response) {
  const user = requireUser(req);
  const timeline = await dashboardService.getTimeline(user, req.params.patientId, parseDays(req));
  res.json({ timeline });
}

export async function getSummary(req: Request, res: Response) {
  const user = requireUser(req);
  const summary = await dashboardService.getPreVisitSummary(user, req.params.patientId, parseDays(req));
  res.json({ summary });
}

export async function getWarnings(req: Request, res: Response) {
  const user = requireUser(req);
  const warnings = await dashboardService.getWarningFlags(user, req.params.patientId, parseDays(req));
  res.json({ warnings });
}

export async function getRoster(req: Request, res: Response) {
  const user = requireUser(req);
  const { days, limit } = req.query as { days?: number; limit?: number };
  res.json(await dashboardService.getRoster(user, days, limit));
}

export async function getAppAnswers(req: Request, res: Response) {
  const user = requireUser(req);
  const result = await appAssessmentService.getAppAnswers(user, req.params.patientId, parseDays(req));
  res.json(result);
}

export async function getVisitComparison(req: Request, res: Response) {
  const user = requireUser(req);
  const comparison = await dashboardService.getVisitComparison(
    user,
    req.params.patientId,
    req.params.appointmentId
  );
  res.json({ comparison });
}
