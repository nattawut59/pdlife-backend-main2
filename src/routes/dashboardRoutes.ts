import { Router } from "express";
import * as dashboardController from "../controllers/dashboardController";
import { requireAuth } from "../middlewares/auth";
import { requireRole } from "../middlewares/rbac";
import { validateQuery } from "../middlewares/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { rosterQuerySchema } from "../schemas/dashboardSchema";

const router = Router();

router.use(requireAuth);

/**
 * ทะเบียนผู้ป่วยทั้งคลินิกพร้อมสรุปของทุกคน
 *
 * อยู่นอก /patients/:patientId เพราะเป็นข้อมูลระดับคลินิก ไม่ได้ผูกกับผู้ป่วยคนใดคนหนึ่ง
 * ไม่ผูก auditLog เพราะเป็น READ (schema §7 เตือนเรื่อง audit_logs โตเร็วเกินไป)
 */
router.get(
  "/roster",
  requireRole("nurse", "doctor", "admin"),
  validateQuery(rosterQuerySchema),
  asyncHandler(dashboardController.getRoster)
);

export default router;
