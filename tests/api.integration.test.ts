import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app";

/**
 * Boots the real app on an ephemeral port and hits it over HTTP. Every test here stays on
 * the validation/auth side of the middleware chain (no live Supabase project is configured
 * for this test run), which is exactly the boundary worth locking in with a real request —
 * these are the checks that must reject bad input before a single DB call happens.
 */
async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("GET /health returns ok", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });
});

test("POST /api/auth/register rejects a staff role from the public endpoint", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: "A",
        last_name: "B",
        user_name: "attacker1",
        password: "password123",
        role: "admin",
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /Validation failed/);
  });
});

test("GET /api/auth/me without a token returns 401", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(res.status, 401);
  });
});

const SUBJECT = "11111111-1111-1111-1111-111111111111";

/**
 * Mirrors what src/utils/jwt.ts signs, so only the field under test differs per case.
 * `null` means "leave this claim out entirely" — it has to be null rather than undefined,
 * because a destructuring default fires on undefined and would silently restore the value
 * the caller was trying to remove.
 */
async function signToken(
  overrides: { secret?: string; issuer?: string | null; audience?: string | null } = {}
) {
  const jwt = await import("jsonwebtoken");
  const { secret = "test", issuer = "pdlife-api", audience = "pdlife-app" } = overrides;
  return jwt.default.sign({ sub: SUBJECT, role: "patient" }, secret, {
    expiresIn: "1h",
    algorithm: "HS256",
    ...(issuer === null ? {} : { issuer }),
    ...(audience === null ? {} : { audience }),
  });
}

test("a well-formed token still fails closed when the user row can't be read", async () => {
  // requireAuth re-reads the user on every request, so a valid signature alone is no longer
  // enough to get through. With no reachable Supabase project the lookup fails, and the only
  // acceptable outcome is an error — never a request that sails past authentication because
  // the database happened to be down. The role/deactivation assertions this test used to make
  // now live in tests/rbac.test.ts, where they run without a database.
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${await signToken()}` },
    });
    assert.equal(res.status, 500, "an unreadable user row must not be treated as authenticated");
  });
});

test("a token signed with the wrong secret is rejected", async () => {
  await withServer(async (baseUrl) => {
    const token = await signToken({ secret: "not-the-real-secret" });
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // 401 before any DB lookup happens — a forged signature never reaches the database.
    assert.equal(res.status, 401);
  });
});

test("a correctly signed token from another service is rejected", async () => {
  // The scenario: JWT_SECRET gets copied into a second project's .env, which happens whenever
  // someone reuses a config file. That service's tokens carry a real signature, so pinning the
  // issuer and audience is the only thing standing between them and a valid session here.
  // Reaching 500 instead would mean the token passed verification and hit the database.
  await withServer(async (baseUrl) => {
    for (const [label, token] of [
      ["no issuer or audience", await signToken({ issuer: null, audience: null })],
      ["someone else's issuer", await signToken({ issuer: "some-other-api" })],
      ["someone else's audience", await signToken({ audience: "some-other-app" })],
    ] as const) {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 401, `${label} must not authenticate`);
    }
  });
});

test("unknown route returns 404", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/does-not-exist`);
    assert.equal(res.status, 404);
  });
});
