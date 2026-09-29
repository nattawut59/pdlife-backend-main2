import type { Request, Response } from "express";
import * as eventLogService from "../services/eventLogService";
import { ApiError } from "../utils/ApiError";

function requireUser(req: Request) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  return req.user;
}

export async function create(req: Request, res: Response) {
  const user = requireUser(req);
  const eventLog = await eventLogService.reportEvent(user, req.params.patientId, req.body);
  res.locals.auditTargetId = eventLog.id;
  res.locals.auditNewValue = eventLog;
  res.status(201).json({ event_log: eventLog });
}

export async function list(req: Request, res: Response) {
  const user = requireUser(req);
  const eventLogs = await eventLogService.listEventLogsForPatient(user, req.params.patientId);
  res.json({ event_logs: eventLogs });
}
