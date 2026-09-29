import { Router } from "express";
import * as redFlagController from "../controllers/redFlagController";
import { requireAuth } from "../middlewares/auth";
import { requireRole } from "../middlewares/rbac";
import { validateBody } from "../middlewares/validate";
import { auditLog } from "../middlewares/auditLog";
import { asyncHandler } from "../utils/asyncHandler";
import { reviewRedFlagSchema } from "../schemas/redFlagSchema";

const router = Router();

router.use(requireAuth);

/**
 * กดรับทราบสัญญาณเตือน
 *
 * เป็น top-level ไม่ใช่ใต้ /patients/:patientId เพราะธงมี id ของตัวเองอยู่แล้ว การบังคับให้
 * ส่ง patient_id มาด้วยเปิดช่องให้ส่งมาไม่ตรงกับเจ้าของธงจริง แล้วต้องมาตรวจซ้ำอีกชั้น
 *
 * ผูก auditLog เพราะเป็นการเปลี่ยนสถานะ — ใครกดปิดสัญญาณเตือนความปลอดภัยตอนไหน
 * เป็นสิ่งที่ต้องตอบได้เสมอ
 */
router.patch(
  "/:flagId/review",
  requireRole("nurse", "doctor", "admin"),
  auditLog("UPDATE", "red_flags"),
  validateBody(reviewRedFlagSchema),
  asyncHandler(redFlagController.review)
);

export default router;
