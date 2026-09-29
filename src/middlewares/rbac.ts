import type { RequestHandler } from "express";
import type { UserRole } from "../config/constants";
import { ApiError } from "../utils/ApiError";

/** Must run after requireAuth. */
export function requireRole(...allowedRoles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new ApiError(401, "Not authenticated"));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new ApiError(403, "Insufficient role for this action"));
    }
    next();
  };
}
