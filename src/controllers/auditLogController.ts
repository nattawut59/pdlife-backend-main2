import type { Request, Response } from "express";
import * as auditLogService from "../services/auditLogService";
import { ApiError } from "../utils/ApiError";
import type { ListAuditLogsQuery } from "../schemas/auditLogSchema";

export async function list(req: Request, res: Response) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  const query = req.query as unknown as ListAuditLogsQuery;
  res.json(await auditLogService.list(req.user, query));
}
