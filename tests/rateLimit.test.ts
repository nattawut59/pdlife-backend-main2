import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app";
import { registerSchema } from "../src/schemas/authSchema";

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

/**
 * Posts a body with no `password`, so validation rejects it before any bcrypt work or database
 * call — the request still counts against the limiter (only 2xx responses are refunded), which
 * lets these tests exhaust a quota quickly without a Supabase project.
 */
function attemptLogin(baseUrl: string, userName: string) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_name: userName }),
  });
}

test("POST /api/auth/login starts refusing after repeated attempts on one account", async () => {
  await withServer(async (baseUrl) => {
    for (let i = 1; i <= 10; i += 1) {
      const res = await attemptLogin(baseUrl, "brute-target");
      assert.equal(res.status, 400, `attempt ${i} should still be allowed through to validation`);
    }

    const blocked = await attemptLogin(baseUrl, "brute-target");
    assert.equal(blocked.status, 429, "the 11th attempt on the same account must be refused");

    const body = (await blocked.json()) as { error: string };
    assert.match(body.error, /Too many requests/);
  });
});

test("exhausting one account does not lock out other accounts on the same address", async () => {
  // The case this protects: a hospital ward shares one NAT address. One nurse mistyping their
  // password ten times must not stop every other nurse from logging in.
  await withServer(async (baseUrl) => {
    for (let i = 0; i < 11; i += 1) {
      await attemptLogin(baseUrl, "noisy-neighbour");
    }
    assert.equal((await attemptLogin(baseUrl, "noisy-neighbour")).status, 429, "quota should be spent");

    const colleague = await attemptLogin(baseUrl, "different-colleague");
    assert.equal(colleague.status, 400, "a different account from the same address must still work");
  });
});

test("password over bcrypt's 72-byte ceiling is rejected, not silently truncated", () => {
  const base = { first_name: "ก", last_name: "ข", user_name: "somchai", role: "patient", phone_number: "0812345678" } as const;

  // Thai is 3 bytes per character in UTF-8: 24 characters is exactly 72 bytes, 30 is 90.
  const twentyFourThai = "ก".repeat(24);
  const thirtyThai = "ก".repeat(30);
  assert.equal(Buffer.byteLength(twentyFourThai, "utf8"), 72);
  assert.equal(Buffer.byteLength(thirtyThai, "utf8"), 90);

  assert.equal(
    registerSchema.safeParse({ ...base, password: twentyFourThai }).success,
    true,
    "72 bytes is the maximum bcrypt reads, so it must be accepted"
  );
  assert.equal(
    registerSchema.safeParse({ ...base, password: thirtyThai }).success,
    false,
    "90 bytes would be truncated by bcrypt, so it must be rejected instead"
  );
});

test("a long Latin password is measured in bytes, not characters", () => {
  const base = { first_name: "A", last_name: "B", user_name: "somsri", role: "patient", phone_number: "0898765432" } as const;

  // 72 Latin characters is 72 bytes — allowed, where 72 Thai characters (216 bytes) is not.
  assert.equal(registerSchema.safeParse({ ...base, password: "a".repeat(72) }).success, true);
  assert.equal(registerSchema.safeParse({ ...base, password: "a".repeat(73) }).success, false);
  assert.equal(registerSchema.safeParse({ ...base, password: "ก".repeat(72) }).success, false);
});
