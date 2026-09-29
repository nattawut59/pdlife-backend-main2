import type { Request, Response } from "express";
import * as prescriptionService from "../services/prescriptionService";
import { ApiError } from "../utils/ApiError";

function requireUser(req: Request) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  return req.user;
}

export async function create(req: Request, res: Response) {
  const user = requireUser(req);
  const prescription = await prescriptionService.createPrescription(
    user,
    req.params.patientId,
    req.body
  );
  res.locals.auditTargetId = prescription.prescription_id;
  res.locals.auditNewValue = prescription;
  res.status(201).json({ prescription });
}

export async function list(req: Request, res: Response) {
  const user = requireUser(req);
  const activeOnly = req.query.active !== "false";
  const prescriptions = await prescriptionService.listPrescriptionsForPatient(
    user,
    req.params.patientId,
    activeOnly
  );
  res.json({ prescriptions });
}

export async function update(req: Request, res: Response) {
  const user = requireUser(req);
  const prescription = await prescriptionService.updatePrescription(user, req.params.id, req.body);
  res.locals.auditTargetId = prescription.prescription_id;
  res.locals.auditNewValue = prescription;
  res.json({ prescription });
}
