import { Router } from "express";
import * as caregiverInviteController from "../controllers/caregiverInviteController";
import { requireAuth } from "../middlewares/auth";
import { requireRole } from "../middlewares/rbac";
import { validateBody } from "../middlewares/validate";
import { auditLog } from "../middlewares/auditLog";
import { caregiverInviteLookupLimiter } from "../middlewares/rateLimit";
import { asyncHandler } from "../utils/asyncHandler";
import { redeemCaregiverInviteSchema } from "../schemas/caregiverInviteSchema";

const router = Router();

router.use(requireAuth);

// ดูตัวอย่างข้อมูลผู้ป่วยก่อนยืนยันเข้าร่วมดูแล (ชื่อ/อายุ/เพศเท่านั้น — ดู caregiverInviteService.ts)
router.get(
  "/:code",
  caregiverInviteLookupLimiter,
  asyncHandler(caregiverInviteController.preview)
);

// ยืนยันเข้าร่วมดูแล — เฉพาะบัญชี role=caregiver เท่านั้น (เหมือน linkCaregiver ปกติ)
router.post(
  "/:code/redeem",
  requireRole("caregiver"),
  caregiverInviteLookupLimiter,
  auditLog("CREATE", "patient_caregivers"),
  validateBody(redeemCaregiverInviteSchema),
  asyncHandler(caregiverInviteController.redeem)
);

export default router;
