import { Router } from "express";
import * as medicationLogController from "../controllers/medicationLogController";
import { requireAuth } from "../middlewares/auth";
import { validateBody } from "../middlewares/validate";
import { auditLog } from "../middlewares/auditLog";
import { asyncHandler } from "../utils/asyncHandler";
import {
  markMedicationTakenSchema,
} from "../schemas/medicationSchema";

const router = Router();

router.use(requireAuth);

router.patch(
  "/:id/taken",
  auditLog("UPDATE", "medication_logs"),
  validateBody(markMedicationTakenSchema),
  asyncHandler(medicationLogController.markTaken)
);

export default router;
