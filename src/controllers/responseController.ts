import type { Request, Response } from "express";
import * as responseService from "../services/responseService";
import { ApiError } from "../utils/ApiError";

function requireUser(req: Request) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  return req.user;
}

export async function submit(req: Request, res: Response) {
  const user = requireUser(req);
  const response = await responseService.submitResponse(
    user,
    req.params.id,
    req.params.questionCode,
    req.body
  );
  res.locals.auditTargetId = response.id;
  res.locals.auditNewValue = response;
  res.json({ response });
}
