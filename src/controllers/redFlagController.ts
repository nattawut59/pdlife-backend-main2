import type { Request, Response } from "express";
import * as redFlagService from "../services/redFlagService";
import { ApiError } from "../utils/ApiError";
import type { ListRedFlagsQuery, ReviewRedFlagBody } from "../schemas/redFlagSchema";

function requireUser(req: Request) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  return req.user;
}

export async function listForPatient(req: Request, res: Response) {
  const user = requireUser(req);
  const query = req.query as ListRedFlagsQuery;

  const result = await redFlagService.listForPatient(user, req.params.patientId, {
    days: query.days,
    // ?reviewed=true (ขอเฉพาะที่ดูแล้ว) ยังไม่รองรับ — มุมมองที่ใช้จริงคือ "ยังไม่มีใครดู"
    onlyUnreviewed: query.reviewed === false,
  });

  res.json(result);
}

export async function review(req: Request, res: Response) {
  const user = requireUser(req);
  const { reviewed } = req.body as ReviewRedFlagBody;

  const flag = await redFlagService.markReviewed(user, req.params.flagId, reviewed);

  // auditLog อ่านค่าพวกนี้ตอนตอบกลับเสร็จ เพื่อบันทึกว่าใครเปลี่ยนอะไร
  res.locals.auditTargetId = flag.id;
  res.locals.auditNewValue = { reviewed: flag.reviewed, reviewed_by: flag.reviewed_by };

  res.json({ flag });
}
