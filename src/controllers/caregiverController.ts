import type { Request, Response } from "express";
import * as caregiverService from "../services/caregiverService";
import { ApiError } from "../utils/ApiError";

function requireUser(req: Request) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  return req.user;
}

export async function linkCaregiver(req: Request, res: Response) {
  const user = requireUser(req);
  const link = await caregiverService.linkCaregiver(user, req.params.patientId, req.body);
  res.locals.auditTargetId = link.id;
  res.locals.auditNewValue = link;
  res.status(201).json({ link });
}

export async function listCaregivers(req: Request, res: Response) {
  const user = requireUser(req);
  const links = await caregiverService.listCaregiversForPatient(user, req.params.patientId);
  res.json({ caregivers: links });
}

export async function getCaregiver(req: Request, res: Response) {
  const user = requireUser(req);
  const caregiver = await caregiverService.getCaregiverForPatient(
    user,
    req.params.patientId,
    req.params.caregiverId
  );
  res.json({ caregiver });
}

export async function updateCaregiverLink(req: Request, res: Response) {
  const user = requireUser(req);
  const link = await caregiverService.updateCaregiverLink(
    user,
    req.params.patientId,
    req.params.linkId,
    req.body
  );
  res.locals.auditTargetId = link.id;
  res.locals.auditNewValue = link;
  res.json({ link });
}

export async function listMyPatients(req: Request, res: Response) {
  const user = requireUser(req);
  const links = await caregiverService.listPatientsForCaregiver(user.sub);
  res.json({ patients: links });
}

export async function searchPatient(req: Request, res: Response) {
  const user = requireUser(req);
  const patient = await caregiverService.searchPatientByIdentifier(
    user,
    req.query.identifier as string
  );
  res.json({ patient });
}

export async function linkPatientByIdentifier(req: Request, res: Response) {
  const user = requireUser(req);
  const result = await caregiverService.linkPatientByIdentifier(
    user,
    req.body.identifier,
    req.body.relationship
  );
  res.locals.auditTargetId = result.link.id;
  res.locals.auditNewValue = result.link;
  res.status(201).json(result);
}
