import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { requireRole } from "../src/middlewares/rbac";
import { ApiError } from "../src/utils/ApiError";

/**
 * `requireRole` is pure — it only reads `req.user`, which `requireAuth` now fills from the
 * database. That makes it unit-testable without a Supabase project, which is the whole reason
 * these assertions live here instead of in an HTTP test: since requireAuth started re-reading
 * the user row, no authenticated request can complete without a reachable DB.
 */
const NOT_CALLED = Symbol("next() was never called");

function runRoleCheck(allowed: Parameters<typeof requireRole>, user?: { sub: string; role: string }) {
  const req = { user } as unknown as Request;
  let passedToNext: unknown = NOT_CALLED;
  requireRole(...allowed)(req, {} as Response, ((err?: unknown) => {
    passedToNext = err;
  }) as never);
  return passedToNext;
}

const PATIENT = { sub: "11111111-1111-1111-1111-111111111111", role: "patient" };
const DOCTOR = { sub: "22222222-2222-2222-2222-222222222222", role: "doctor" };

test("requireRole: rejects a patient from a staff-only route", () => {
  const err = runRoleCheck(["nurse", "doctor"], PATIENT);
  assert.ok(err instanceof ApiError);
  assert.equal(err.statusCode, 403);
});

test("requireRole: lets an allowed role through with no error", () => {
  const err = runRoleCheck(["nurse", "doctor"], DOCTOR);
  assert.equal(err, undefined, "next() should be called with no argument");
});

test("requireRole: unauthenticated request is 401, not 403", () => {
  // 401 vs 403 matters to the client: 401 means "log in", 403 means "logging in won't help".
  const err = runRoleCheck(["doctor"], undefined);
  assert.ok(err instanceof ApiError);
  assert.equal(err.statusCode, 401);
});

test("requireRole: a patient cannot reach a staff route even for their own data", () => {
  // The dashboard routes are staff-only by design — being the subject of the data is not the
  // same as being allowed to read the clinical view of it.
  const err = runRoleCheck(["nurse", "doctor", "admin"], PATIENT);
  assert.ok(err instanceof ApiError);
  assert.equal(err.statusCode, 403);
});
