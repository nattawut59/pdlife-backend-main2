import type { Request, Response } from "express";
import * as doctorNoteService from "../services/doctorNoteService";
import * as clinicAssessmentService from "../services/clinicAssessmentService";
import { ApiError } from "../utils/ApiError";
import type { SaveDoctorNoteBody } from "../schemas/doctorNoteSchema";

function requireUser(req: Request) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  return req.user;
}

export async function getForAppointment(req: Request, res: Response) {
  const user = requireUser(req);

  const note = await doctorNoteService.getByAppointment(user, req.params.appointmentId);

  // null = ยังไม่มีใครบันทึกผลของนัดนี้ ไม่ใช่ 404 — นัดมีจริง แค่ยังไม่ได้ตรวจ
  res.json({ note });
}

export async function save(req: Request, res: Response) {
  const user = requireUser(req);
  const body = req.body as SaveDoctorNoteBody;

  const note = await doctorNoteService.save(user, req.params.appointmentId, body);

  res.locals.auditTargetId = note.id;
  res.locals.auditNewValue = {
    appointment_id: note.appointment_id,
    medication_adjustment: note.medication_adjustment,
    follow_up_urgency: note.follow_up_urgency,
    next_appointment_date: note.next_appointment_date,
  };

  res.json({ note });
}

/** แพทย์กดเปิดหน้าต่างตรวจ = เปิดอ่านฟอร์มคัดกรองของนัดนั้น */
export async function markAssessmentOpened(req: Request, res: Response) {
  const user = requireUser(req);

  const assessment = await clinicAssessmentService.markOpened(user, req.params.appointmentId);

  res.json({ assessment });
}
