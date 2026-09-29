import { Router } from "express";
import * as roundController from "../controllers/roundController";
import * as responseController from "../controllers/responseController";
import { requireAuth } from "../middlewares/auth";
import { validateBody } from "../middlewares/validate";
import { auditLog } from "../middlewares/auditLog";
import { asyncHandler } from "../utils/asyncHandler";
import { createAdhocRoundSchema } from "../schemas/roundSchema";
import { submitResponseSchema } from "../schemas/responseSchema";

const router = Router();

router.use(requireAuth);

router.post(
  "/adhoc",
  auditLog("CREATE", "round_instances"),
  validateBody(createAdhocRoundSchema),
  asyncHandler(roundController.createAdhoc)
);

router.get("/:id", asyncHandler(roundController.getOne));
router.get("/:id/questions", asyncHandler(roundController.getQuestions));

router.put(
  "/:id/responses/:questionCode",
  auditLog("CREATE", "responses"),
  validateBody(submitResponseSchema),
  asyncHandler(responseController.submit)
);

export default router;
