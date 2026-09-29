import type { Request, Response } from "express";
import * as medicationLogService from "../services/medicationLogService";
import { ApiError } from "../utils/ApiError";

function requireUser(req: Request) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  return req.user;
}

export async function list(req: Request, res: Response) {
  const user = requireUser(req);
  const logs = await medicationLogService.listLogsForPatient(
    user,
    req.params.patientId,
    req.query.activity_date as string | undefined
  );
  res.json({ logs });
}

export async function markTaken(req: Request, res: Response) {
  const user = requireUser(req);
  const log = await medicationLogService.markTaken(user, req.params.id, req.body);
  res.locals.auditTargetId = log.id;
  res.locals.auditNewValue = log;
  res.json({ log });
}
