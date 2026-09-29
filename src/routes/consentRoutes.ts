import { Router } from "express";
import * as consentController from "../controllers/consentController";
import { requireAuth } from "../middlewares/auth";
import { validateBody } from "../middlewares/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { acceptConsentSchema } from "../schemas/consentSchema";

const router = Router();
router.use(requireAuth);
router.get("/me", asyncHandler(consentController.getMine));
router.post("/", validateBody(acceptConsentSchema), asyncHandler(consentController.accept));
export default router;
