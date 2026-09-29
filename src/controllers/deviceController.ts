import type { Request, Response } from "express";
import * as deviceService from "../services/deviceService";
import { ApiError } from "../utils/ApiError";

function requireUser(req: Request) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  return req.user;
}

export async function register(req: Request, res: Response) {
  const user = requireUser(req);
  const device = await deviceService.registerMyDevice(user.sub, req.body);
  res.locals.auditTargetId = device.id;
  res.locals.auditNewValue = device;
  res.status(201).json({ device });
}

export async function updatePushEnabled(req: Request, res: Response) {
  const user = requireUser(req);
  const device = await deviceService.updatePushEnabled(user.sub, req.params.id, req.body.push_enabled);
  res.locals.auditTargetId = device.id;
  res.locals.auditNewValue = device;
  res.json({ device });
}
