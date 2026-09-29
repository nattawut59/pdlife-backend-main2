import { supabase } from "../src/config/supabaseClient";

const required = [
  ["medication_logs", "activity_date,idempotency_key"],
  ["round_instances", "activity_date,available_at,due_at,idempotency_key"],
  ["patient_allergies", "id,patient_id,substance"],
] as const;

async function main() {
  let failed = false;
  for (const [table, columns] of required) {
    const { error } = await supabase.from(table).select(columns).limit(1);
    if (error) {
      failed = true;
      console.error(`${table}: missing or inaccessible (${error.code || "unknown"}: ${error.message})`);
    } else {
      console.log(`${table}: OK`);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Database schema check failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
