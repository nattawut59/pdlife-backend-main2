import type { RequestHandler } from "express";
import type { ZodTypeAny } from "zod";
import { ApiError } from "../utils/ApiError";

export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new ApiError(400, "Validation failed", result.error.flatten().fieldErrors));
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(new ApiError(400, "Validation failed", result.error.flatten().fieldErrors));
    }
    req.query = result.data;
    next();
  };
}
