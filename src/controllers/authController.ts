import type { Request, Response } from "express";
import * as authService from "../services/authService";
import { ApiError } from "../utils/ApiError";

export async function register(req: Request, res: Response) {
  const user = await authService.register(req.body);
  res.locals.auditTargetId = user.id;
  res.locals.auditNewValue = user;
  res.status(201).json({ user });
}

export async function provision(req: Request, res: Response) {
  const user = await authService.provision(req.body);
  res.locals.auditTargetId = user.id;
  res.locals.auditNewValue = user;
  res.status(201).json({ user });
}

export async function login(req: Request, res: Response) {
  const result = await authService.login(req.body);
  res.json(result);
}

export async function me(req: Request, res: Response) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  const user = await authService.getCurrentUser(req.user.sub);
  res.json({ user });
}
