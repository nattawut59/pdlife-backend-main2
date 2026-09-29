import type { Request, Response } from "express";
import * as caregiverInviteService from "../services/caregiverInviteService";
import { ApiError } from "../utils/ApiError";

function requireUser(req: Request) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  return req.user;
}

export async function create(req: Request, res: Response) {
  const user = requireUser(req);
  const invite = await caregiverInviteService.createInvite(user, req.params.patientId);
  res.status(201).json({ invite });
}

export async function preview(req: Request, res: Response) {
  requireUser(req);
  const invite = await caregiverInviteService.previewInvite(req.params.code);
  res.json({ invite });
}

export async function redeem(req: Request, res: Response) {
  const user = requireUser(req);
  const result = await caregiverInviteService.redeemInvite(
    user,
    req.params.code,
    req.body.relationship
  );
  res.locals.auditTargetId = result.link.id;
  res.locals.auditNewValue = result.link;
  res.status(201).json(result);
}
