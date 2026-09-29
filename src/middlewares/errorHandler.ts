import type { ErrorRequestHandler, RequestHandler } from "express";
import { ApiError } from "../utils/ApiError";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found" });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const statusCode = err instanceof ApiError ? err.statusCode : 500;
  if (statusCode === 500) console.error(err);

  res.status(statusCode).json({
    error: err instanceof Error ? err.message : "Internal server error",
    ...(err instanceof ApiError && err.details ? { details: err.details } : {}),
  });
};
