import { Router } from "express";
import * as appUserController from "../controllers/appUserController";
import { requireAuth } from "../middlewares/auth";
import { requireRole } from "../middlewares/rbac";
import { validateBody, validateQuery } from "../middlewares/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { listStaffQuerySchema } from "../schemas/appointmentSchema";
import { lookupCaregiverQuerySchema, updateMyPreferencesSchema } from "../schemas/userSchema";
import { phoneLookupLimiter } from "../middlewares/rateLimit";

const router = Router();

router.use(requireAuth);
router.patch("/me", validateBody(updateMyPreferencesSchema), asyncHandler(appUserController.updateMyPreferences));

/**
 * ใครใช้แอปอยู่จริง — เจ้าหน้าที่คลินิกเท่านั้น
 *
 * มีเบอร์โทรของผู้ป่วยและผู้ดูแลทุกคนในคลินิกอยู่ในคำตอบเดียว รั่วทีเดียวหมดทั้งคลินิก
 * จึงกันด้วย requireRole เหมือน /dashboard/roster
 *
 * ไม่ผูก auditLog เพราะเป็น READ (schema §7 เตือนเรื่อง audit_logs โตเร็วเกินไป)
 */
router.get(
  "/app-users",
  requireRole("nurse", "doctor", "admin"),
  asyncHandler(appUserController.listAppUsers)
);

/**
 * รายชื่อบุคลากร — ใช้ทำช่องเลือกแพทย์ตอนสร้างนัด
 *
 * คนละเรื่องกับ /app-users ข้างบนซึ่งเป็นผู้ป่วยและผู้ดูแล อันนี้คือคนของคลินิก
 *
 * ไม่กันด้วย requireRole เหมือน /app-users — คืนแค่ชื่อ ไม่มีเบอร์โทร/ข้อมูลอ่อนไหว และ
 * ผู้ป่วย/ผู้ดูแลต้องเรียกได้ด้วยเพื่อเลือกหมอตอนจองนัดเอง (ดู available-slots)
 */
router.get(
  "/staff",
  validateQuery(listStaffQuerySchema),
  asyncHandler(appUserController.listStaff)
);

/**
 * ค้นผู้ดูแลจากเบอร์โทร — ผูกผู้ดูแลต้องใช้ caregiver_id (UUID) แต่ผู้ป่วยรู้แค่เบอร์
 *
 * ไม่กันด้วย requireRole เพราะคนที่ต้องใช้จริงคือผู้ป่วยเอง แต่กันด้วย rate limit แทน
 * เหตุผลเต็มและข้อจำกัดอีกสองชั้นอยู่ที่ appUserService.lookupCaregiverByPhone
 */
router.get(
  "/lookup",
  phoneLookupLimiter,
  validateQuery(lookupCaregiverQuerySchema),
  asyncHandler(appUserController.lookupCaregiver)
);

export default router;
