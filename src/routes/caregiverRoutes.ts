import { Router } from "express";
import * as caregiverController from "../controllers/caregiverController";
import { requireAuth } from "../middlewares/auth";
import { requireRole } from "../middlewares/rbac";
import { validateBody, validateQuery } from "../middlewares/validate";
import { auditLog } from "../middlewares/auditLog";
import { searchPatientLimiter } from "../middlewares/rateLimit";
import { asyncHandler } from "../utils/asyncHandler";
import {
  searchPatientByIdentifierQuerySchema,
  linkPatientByIdentifierSchema,
} from "../schemas/caregiverPatientSearchSchema";

const router = Router();

router.get(
  "/me/patients",
  requireAuth,
  requireRole("caregiver"),
  asyncHandler(caregiverController.listMyPatients)
);

// ค้นผู้ป่วยด้วยเลขบัตรประชาชน/HN — ดูตัวอย่างชื่อ/อายุ/เพศก่อนกดผูกจริง (ดู
// caregiverService.ts::searchPatientByIdentifier ว่าทำไมไม่มีขั้นรอผู้ป่วยอนุมัติ)
router.get(
  "/patients/search",
  requireAuth,
  requireRole("caregiver"),
  searchPatientLimiter,
  validateQuery(searchPatientByIdentifierQuerySchema),
  asyncHandler(caregiverController.searchPatient)
);

// ผูกทันทีหลังค้นเจอ — ไม่มีขั้นรออนุมัติจากผู้ป่วย (ตัดสินใจร่วมกับผู้ใช้แล้ว ดูคอมเมนต์เต็มที่
// caregiverService.ts::linkPatientByIdentifier)
router.post(
  "/patients/link",
  requireAuth,
  requireRole("caregiver"),
  searchPatientLimiter,
  auditLog("CREATE", "patient_caregivers"),
  validateBody(linkPatientByIdentifierSchema),
  asyncHandler(caregiverController.linkPatientByIdentifier)
);

export default router;
