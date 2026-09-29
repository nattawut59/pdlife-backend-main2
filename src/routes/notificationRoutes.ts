import { Router } from "express";
import * as notificationController from "../controllers/notificationController";
import { requireAuth } from "../middlewares/auth";
import { validateQuery } from "../middlewares/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { listNotificationsQuerySchema } from "../schemas/notificationSchema";

const router = Router();

router.use(requireAuth);

/**
 * แจ้งเตือนของตัวเองเท่านั้น — service กรองด้วย user_id จาก token เสมอ ไม่รับ user_id จากผู้เรียก
 *
 * ไม่ผูก auditLog เพราะเป็น READ (schema §7 เตือนว่า audit_logs จะโตเร็วเกินไป) — เหมือน
 * /users/app-users
 */
router.get(
  "/",
  validateQuery(listNotificationsQuerySchema),
  asyncHandler(notificationController.list)
);

/**
 * กดอ่านแจ้งเตือนของตัวเอง — ไม่ผูก auditLog เช่นกัน เพราะเป็นสถานะการอ่านของผู้ใช้เอง
 * ไม่ใช่การแก้ข้อมูลผู้ป่วย และเกิดบ่อยพอ ๆ กับการเปิดแอป
 */
router.patch("/:id/read", asyncHandler(notificationController.markRead));
router.patch("/:id/unread", asyncHandler(notificationController.markUnread));
router.patch("/read-all", asyncHandler(notificationController.markAllRead));
router.delete("/:id", asyncHandler(notificationController.remove));

export default router;
