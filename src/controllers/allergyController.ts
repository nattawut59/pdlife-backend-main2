import type { Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import * as allergyService from "../services/allergyService";

function requireUser(req: Request) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  return req.user;
}

export async function list(req: Request, res: Response) {
  res.json({ allergies: await allergyService.list(requireUser(req), req.params.patientId) });
}

export async function add(req: Request, res: Response) {
  const allergy = await allergyService.add(requireUser(req), req.params.patientId, req.body.substance);
  res.status(201).json({ allergy });
}

export async function remove(req: Request, res: Response) {
  await allergyService.remove(requireUser(req), req.params.patientId, req.params.allergyId);
  res.status(204).send();
}
