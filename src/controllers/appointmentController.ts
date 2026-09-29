import type { Request, Response } from "express";
import * as appointmentService from "../services/appointmentService";
import { ApiError } from "../utils/ApiError";
import type {
  CreateAppointmentBody,
  CreateSelfAppointmentBody,
  ListAppointmentCountsQuery,
  ListAppointmentsQuery,
  ListAvailableSlotsQuery,
  ListPatientAppointmentsQuery,
  UpdateAppointmentStatusBody,
} from "../schemas/appointmentSchema";

function requireUser(req: Request) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  return req.user;
}

export async function list(req: Request, res: Response) {
  const user = requireUser(req);
  const query = req.query as unknown as ListAppointmentsQuery;

  const result = await appointmentService.list(user, {
    date: query.date,
    before: query.before,
    patient_id: query.patient_id,
    limit: query.limit,
  });

  res.json(result);
}

export async function create(req: Request, res: Response) {
  const user = requireUser(req);
  const body = req.body as CreateAppointmentBody;

  const appointment = await appointmentService.create(user, body);

  // auditLog อ่านค่าพวกนี้ตอนตอบกลับเสร็จ เพื่อบันทึกว่าใครสร้างนัดให้ใคร
  res.locals.auditTargetId = appointment.id;
  res.locals.auditNewValue = {
    patient_id: appointment.patient_id,
    visit_date: body.visit_date,
    visit_time: appointment.visit_time,
    visit_type: appointment.visit_type,
    status: appointment.status,
  };

  res.status(201).json({ appointment });
}

export async function listAvailableSlots(req: Request, res: Response) {
  requireUser(req);
  const query = req.query as unknown as ListAvailableSlotsQuery;

  const slots = await appointmentService.listAvailableSlots(query.doctor_id, query.date);

  res.json({ doctor_id: query.doctor_id, date: query.date, slots });
}

export async function createSelfBooking(req: Request, res: Response) {
  const user = requireUser(req);
  const body = req.body as CreateSelfAppointmentBody;

  const appointment = await appointmentService.createSelfBooking(user, req.params.patientId, body);

  res.locals.auditTargetId = appointment.id;
  res.locals.auditNewValue = {
    patient_id: appointment.patient_id,
    visit_date: body.visit_date,
    visit_time: appointment.visit_time,
    visit_type: appointment.visit_type,
    status: appointment.status,
  };

  res.status(201).json({ appointment });
}

export async function listDailyCounts(req: Request, res: Response) {
  const user = requireUser(req);
  const query = req.query as unknown as ListAppointmentCountsQuery;

  const counts = await appointmentService.listDailyCounts(user, query.from, query.to);
  res.json({ from: query.from, to: query.to, counts });
}

export async function listForPatient(req: Request, res: Response) {
  const user = requireUser(req);
  const query = req.query as unknown as ListPatientAppointmentsQuery;

  const result = await appointmentService.listForPatient(user, req.params.patientId, {
    limit: query.limit,
    from: query.from,
    to: query.to,
    date: query.date,
  });

  res.json(result);
}

export async function updateStatus(req: Request, res: Response) {
  const user = requireUser(req);
  const { status } = req.body as UpdateAppointmentStatusBody;

  const appointment = await appointmentService.updateStatus(user, req.params.appointmentId, status);

  res.locals.auditTargetId = appointment.id;
  res.locals.auditNewValue = { status: appointment.status };

  res.json({ appointment });
}
