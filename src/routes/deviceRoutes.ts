import { Router } from "express";
import * as deviceController from "../controllers/deviceController";
import { requireAuth } from "../middlewares/auth";
import { validateBody } from "../middlewares/validate";
import { auditLog } from "../middlewares/auditLog";
import { asyncHandler } from "../utils/asyncHandler";
import { registerDeviceSchema, updateDeviceSchema } from "../schemas/deviceSchema";

const router = Router();

router.use(requireAuth);

router.post(
  "/",
  auditLog("CREATE", "devices"),
  validateBody(registerDeviceSchema),
  asyncHandler(deviceController.register)
);

router.patch(
  "/:id",
  auditLog("UPDATE", "devices"),
  validateBody(updateDeviceSchema),
  asyncHandler(deviceController.updatePushEnabled)
);

export default router;
