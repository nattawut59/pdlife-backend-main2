import { Router } from "express";
import * as auditLogController from "../controllers/auditLogController";
import { requireAuth } from "../middlewares/auth";
import { requireRole } from "../middlewares/rbac";
import { validateQuery } from "../middlewares/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { listAuditLogsQuerySchema } from "../schemas/auditLogSchema";

const router = Router();

router.use(requireAuth);

/**
 * ประวัติการเปลี่ยนแปลงข้อมูลทั้งระบบ — เห็นได้ว่าใครแก้อะไรของใคร จึงจำกัดไว้แค่ admin
 * ต่างจาก endpoint staff ทั่วไป (service เป็นด่านที่รับประกันจริงอีกชั้น เผื่อวันหนึ่งมีคน
 * เรียก service ตรงๆ โดยข้าม route นี้)
 *
 * ไม่ผูก auditLog middleware กับตัวเอง — อ่าน audit log ไม่ควรสร้าง audit log ใหม่วนไม่รู้จบ
 */
router.get(
  "/",
  requireRole("admin"),
  validateQuery(listAuditLogsQuerySchema),
  asyncHandler(auditLogController.list)
);

export default router;
