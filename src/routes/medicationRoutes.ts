import { Router } from "express";
import * as medicationController from "../controllers/medicationController";
import { requireAuth } from "../middlewares/auth";
import { requireRole } from "../middlewares/rbac";
import { validateBody } from "../middlewares/validate";
import { auditLog } from "../middlewares/auditLog";
import { asyncHandler } from "../utils/asyncHandler";
import { createMedicationSchema, updateMedicationSchema } from "../schemas/medicationSchema";

const router = Router();

router.use(requireAuth);

router.get("/", asyncHandler(medicationController.list));
router.get("/:id", asyncHandler(medicationController.getOne));

router.post(
  "/",
  requireRole("admin"),
  auditLog("CREATE", "medications"),
  validateBody(createMedicationSchema),
  asyncHandler(medicationController.create)
);

router.patch(
  "/:id",
  requireRole("admin"),
  auditLog("UPDATE", "medications"),
  validateBody(updateMedicationSchema),
  asyncHandler(medicationController.update)
);

export default router;
