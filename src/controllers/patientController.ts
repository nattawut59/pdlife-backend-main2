import type { Request, Response } from "express";
import * as patientService from "../services/patientService";
import { ApiError } from "../utils/ApiError";
import * as statisticsService from "../services/statisticsService";

function requireUser(req: Request) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  return req.user;
}

export async function createOwnProfile(req: Request, res: Response) {
  const user = requireUser(req);
  const profile = await patientService.createPatientProfile(user.sub, req.body);
  res.locals.auditTargetId = profile.user_id;
  res.locals.auditNewValue = profile;
  res.status(201).json({ profile });
}

export async function createProfileFor(req: Request, res: Response) {
  const profile = await patientService.createPatientProfile(req.params.userId, req.body);
  res.locals.auditTargetId = profile.user_id;
  res.locals.auditNewValue = profile;
  res.status(201).json({ profile });
}

export async function getOwnProfile(req: Request, res: Response) {
  const user = requireUser(req);
  const profile = await patientService.getPatientProfile(user, user.sub);
  res.json({ profile });
}

export async function getProfile(req: Request, res: Response) {
  const user = requireUser(req);
  const profile = await patientService.getPatientProfile(user, req.params.userId);
  res.json({ profile });
}

export async function updateProfile(req: Request, res: Response) {
  const user = requireUser(req);
  const profile = await patientService.updatePatientProfile(user, req.params.userId, req.body);
  res.locals.auditTargetId = req.params.userId;
  res.locals.auditNewValue = profile;
  res.json({ profile });
}

export async function listPatients(req: Request, res: Response) {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const offset = req.query.offset ? Number(req.query.offset) : undefined;
  const patients = await patientService.listPatients(limit, offset);
  res.json({ patients });
}

export async function getStatistics(req: Request, res: Response) {
  const user = requireUser(req);
  const statistics = await statisticsService.getStatistics(user, req.params.patientId, Number(req.query.days));
  res.json({ statistics });
}

export async function getSelfSummary(req: Request, res: Response) {
  const user = requireUser(req);
  const statistics = await statisticsService.getStatistics(user, req.params.patientId, Number(req.query.days));
  const { daily: _daily, range_days: _rangeDays, ...summary } = statistics;
  const hasSummary = summary.adherence_rate != null || summary.off_rate != null || summary.dyskinesia_rate != null;
  res.json({ summary: hasSummary ? summary : null });
}

export async function getDailyFluctuation(req: Request, res: Response) {
  const user = requireUser(req);
  const fluctuation = await statisticsService.getDailyFluctuation(
    user,
    req.params.patientId,
    req.query.date as string,
  );
  res.json({ fluctuation });
}
