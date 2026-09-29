import type { Request, Response } from "express";
import * as medicationService from "../services/medicationService";

export async function list(_req: Request, res: Response) {
  const medications = await medicationService.listMedications();
  res.json({ medications });
}

export async function getOne(req: Request, res: Response) {
  const medication = await medicationService.getMedication(req.params.id);
  res.json({ medication });
}

export async function create(req: Request, res: Response) {
  const medication = await medicationService.createMedication(req.body);
  res.locals.auditTargetId = medication.id;
  res.locals.auditNewValue = medication;
  res.status(201).json({ medication });
}

export async function update(req: Request, res: Response) {
  const medication = await medicationService.updateMedication(req.params.id, req.body);
  res.locals.auditTargetId = medication.id;
  res.locals.auditNewValue = medication;
  res.json({ medication });
}
