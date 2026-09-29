import type { Request, Response } from "express";
import * as notificationService from "../services/notificationService";
import { ApiError } from "../utils/ApiError";
import type { ListNotificationsQuery } from "../schemas/notificationSchema";

function requireUser(req: Request) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  return req.user;
}

export async function list(req: Request, res: Response) {
  const user = requireUser(req);
  const query = req.query as unknown as ListNotificationsQuery;

  const notifications = await notificationService.listMyNotifications(user.sub, {
    unreadOnly: query.unread_only,
    limit: query.limit,
  });
  res.json({ notifications });
}

export async function markRead(req: Request, res: Response) {
  const user = requireUser(req);
  const notification = await notificationService.markMyNotificationRead(user.sub, req.params.id);
  res.json({ notification });
}

export async function markUnread(req: Request, res: Response) {
  const user = requireUser(req);
  const notification = await notificationService.markMyNotificationUnread(user.sub, req.params.id);
  res.json({ notification });
}

export async function markAllRead(req: Request, res: Response) {
  const user = requireUser(req);
  await notificationService.markAllMyNotificationsRead(user.sub);
  res.status(204).send();
}

export async function remove(req: Request, res: Response) {
  const user = requireUser(req);
  await notificationService.deleteMyNotification(user.sub, req.params.id);
  res.status(204).send();
}
