import { Router } from "express";
import * as prescriptionController from "../controllers/prescriptionController";
import { requireAuth } from "../middlewares/auth";
import { requireRole } from "../middlewares/rbac";
import { validateBody } from "../middlewares/validate";
import { auditLog } from "../middlewares/auditLog";
import { asyncHandler } from "../utils/asyncHandler";
import { updatePrescriptionSchema } from "../schemas/medicationSchema";

const router = Router();

router.use(requireAuth);

// admin รวมอยู่ด้วยตามคำขอ (2026-09) — ดูเหตุผลเดียวกันที่ patientRoutes.ts (POST prescriptions)
router.patch(
  "/:id",
  requireRole("doctor", "nurse", "admin"),
  auditLog("UPDATE", "patient_medications"),
  validateBody(updatePrescriptionSchema),
  asyncHandler(prescriptionController.update)
);

export default router;
