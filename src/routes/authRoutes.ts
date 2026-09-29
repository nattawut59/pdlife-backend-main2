import { Router } from "express";
import * as authController from "../controllers/authController";
import { requireAuth } from "../middlewares/auth";
import { requireRole } from "../middlewares/rbac";
import { validateBody } from "../middlewares/validate";
import { auditLog } from "../middlewares/auditLog";
import { asyncHandler } from "../utils/asyncHandler";
import {
  authIpLimiter,
  loginBruteForceLimiter,
  registerLimiter,
} from "../middlewares/rateLimit";
import { loginSchema, provisionSchema, registerSchema } from "../schemas/authSchema";

const router = Router();

// Limiters run ahead of validation and the controller so a flood is turned away before it can
// spend a bcrypt hash or a database round trip.

// Public self-signup — role limited to patient|caregiver by registerSchema.
router.post(
  "/register",
  authIpLimiter,
  registerLimiter,
  auditLog("CREATE", "users"),
  validateBody(registerSchema),
  asyncHandler(authController.register)
);

// Admin-only — creates accounts for any role, including nurse/doctor/admin staff.
router.post(
  "/provision",
  requireAuth,
  requireRole("admin"),
  auditLog("CREATE", "users"),
  validateBody(provisionSchema),
  asyncHandler(authController.provision)
);

router.post(
  "/login",
  authIpLimiter,
  loginBruteForceLimiter,
  validateBody(loginSchema),
  asyncHandler(authController.login)
);

router.get("/me", requireAuth, asyncHandler(authController.me));

export default router;
