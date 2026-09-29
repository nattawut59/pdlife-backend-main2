import type { Request, Response } from "express";
import * as clinicAssessmentService from "../services/clinicAssessmentService";
import { ApiError } from "../utils/ApiError";
import type { SaveAssessmentBody } from "../schemas/clinicAssessmentSchema";

function requireUser(req: Request) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  return req.user;
}

export async function getForAppointment(req: Request, res: Response) {
  const user = requireUser(req);

  const assessment = await clinicAssessmentService.getByAppointment(
    user,
    req.params.appointmentId
  );

  // null = ยังไม่เคยมีใครกรอกฟอร์มของนัดนี้ ไม่ใช่ 404 — นัดมีจริง แค่ยังไม่มีฟอร์ม
  res.json({ assessment });
}

export async function save(req: Request, res: Response) {
  const user = requireUser(req);
  const body = req.body as SaveAssessmentBody;

  const assessment = await clinicAssessmentService.save(user, req.params.appointmentId, body);

  res.locals.auditTargetId = assessment.id;
  res.locals.auditNewValue = {
    appointment_id: assessment.appointment_id,
    status: assessment.status,
    screened_by: assessment.screened_by,
  };

  res.json({ assessment });
}
