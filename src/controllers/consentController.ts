import type { Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import * as consentService from "../services/consentService";

function userId(req: Request) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  return req.user.sub;
}

export async function getMine(req: Request, res: Response) {
  res.json(await consentService.getMyConsent(userId(req)));
}

export async function accept(req: Request, res: Response) {
  const consent = await consentService.acceptMyConsent(userId(req), req.body.version, req.ip ?? null);
  res.status(201).json({ consent });
}
