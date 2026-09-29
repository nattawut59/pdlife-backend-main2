/**
 * Read-only API benchmark against the configured TEST Supabase project.
 * ไม่พิมพ์ token, ชื่อ หรือ id ผู้ป่วย และไม่สร้าง/แก้ข้อมูลใด ๆ
 */
import { createApp } from "../src/app";
import { supabase } from "../src/config/supabaseClient";
import { env } from "../src/config/env";
import { signToken } from "../src/utils/jwt";

const TEST_PROJECT_REF = "oibjuxjiaftkcdhxyvuh";
if (!env.supabaseUrl.includes(TEST_PROJECT_REF)) {
  throw new Error("Performance audit is allowed only on the test Supabase project");
}

async function main() {
  const { data: users, error } = await supabase
    .from("users")
    .select("id,role")
    .eq("role", "patient")
    .eq("is_active", true)
    .limit(1);
  if (error) throw error;
  const patient = users?.[0];
  if (!patient) throw new Error("No active test patient available");

  const token = signToken({ sub: patient.id, role: "patient" });
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Cannot bind benchmark server");
  const origin = `http://127.0.0.1:${address.port}`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const endpoints = [
    ["rounds", `/api/patients/${patient.id}/rounds?status=pending&actionable_at=${encodeURIComponent(new Date().toISOString())}&include_progress=true`],
    ["medication logs", `/api/patients/${patient.id}/medication-logs?activity_date=${today}`],
    ["prescriptions", `/api/patients/${patient.id}/prescriptions`],
    ["self summary", `/api/patients/${patient.id}/self-summary`],
    ["statistics 7d", `/api/patients/${patient.id}/statistics?days=7`],
    ["appointments month", `/api/patients/${patient.id}/appointments?from=${today}&to=${today}&limit=100`],
  ] as const;

  console.log("endpoint\tstatus\tbytes\tcold_ms\twarm_median_ms");
  try {
    for (const [label, path] of endpoints) {
      const samples: Array<{ ms: number; status: number; bytes: number }> = [];
      for (let i = 0; i < 4; i += 1) {
        const start = performance.now();
        const response = await fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${token}` } });
        const bytes = (await response.arrayBuffer()).byteLength;
        samples.push({ ms: performance.now() - start, status: response.status, bytes });
      }
      const warm = samples.slice(1).map((sample) => sample.ms).sort((a, b) => a - b);
      console.log(`${label}\t${samples[0].status}\t${samples[0].bytes}\t${samples[0].ms.toFixed(1)}\t${warm[1].toFixed(1)}`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
}

main().catch((error: unknown) => {
  console.error("Performance audit failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
