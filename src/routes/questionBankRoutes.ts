import { Router } from "express";
import * as questionBankController from "../controllers/questionBankController";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.use(requireAuth);

/**
 * คลังคำถามทั้งหมด — ทุกบัญชีที่ login แล้วเรียกได้ ไม่ต้อง requireRole เหมือน
 * /api/medications เพราะไม่ใช่ข้อมูลผู้ป่วย ไม่ไวเท่า audit log
 */
router.get("/", asyncHandler(questionBankController.list));

export default router;
