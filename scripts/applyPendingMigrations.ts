import dotenv from "dotenv";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

dotenv.config({ path: resolve(__dirname, "../.env.admin") });

const connectionString = process.env.PDLIFE_DATABASE_ADMIN_URL;
if (!connectionString) {
  throw new Error("Add PDLIFE_DATABASE_ADMIN_URL to the git-ignored .env.admin file first");
}

const migrations = [
  { number: "0009", file: "0009_add_patient_allergies.sql" },
  { number: "0010", file: "0010_activity_schedule_idempotency.sql" },
  { number: "0014", file: "0014_post_med_rounds_follow_schedule.sql" },
] as const;

async function hasTable(client: Client, table: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [`pdlife.${table}`],
  );
  return result.rows[0].exists;
}

async function columnCount(client: Client, table: string, columns: string[]): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM information_schema.columns
     WHERE table_schema = 'pdlife' AND table_name = $1 AND column_name = ANY($2)`,
    [table, columns],
  );
  return Number(result.rows[0].count);
}

async function migrationState(client: Client, number: string): Promise<"pending" | "applied"> {
  if (number === "0009") return (await hasTable(client, "patient_allergies")) ? "applied" : "pending";

  if (number === "0014") {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pdlife.round_instances AS round
       JOIN pdlife.medication_logs AS log ON log.id = round.medication_log_id
       WHERE round.template_code = 'POST_MED_MICRO'
         AND round.status = 'pending'
         AND round.completed_at IS NULL
         AND round.submitted_at IS NULL
         AND (
           round.target_dose_at IS DISTINCT FROM log.planned_at OR
           round.scheduled_at IS DISTINCT FROM log.planned_at + INTERVAL '30 minutes' OR
           round.available_at IS DISTINCT FROM log.planned_at + INTERVAL '30 minutes' OR
           round.due_at IS DISTINCT FROM log.planned_at + INTERVAL '30 minutes' OR
           round.expires_at IS DISTINCT FROM log.planned_at + INTERVAL '60 minutes'
         )`,
    );
    return Number(result.rows[0].count) === 0 ? "applied" : "pending";
  }

  const medicationCount = await columnCount(client, "medication_logs", ["activity_date", "idempotency_key"]);
  const roundCount = await columnCount(client, "round_instances", ["activity_date", "available_at", "due_at", "idempotency_key"]);
  if (medicationCount === 0 && roundCount === 0) return "pending";
  if (medicationCount === 2 && roundCount === 4) return "applied";
  throw new Error("Migration 0010 appears partially applied; inspect the database before continuing");
}

async function main() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: true } });
  try {
    await client.connect();
    const identity = await client.query<{ database: string; role: string; schema_exists: boolean }>(
      "SELECT current_database() AS database, current_user AS role, to_regnamespace('pdlife') IS NOT NULL AS schema_exists",
    );
    if (!identity.rows[0].schema_exists) throw new Error("pdlife schema not found; refusing to migrate");
    console.log(`Connected to database ${identity.rows[0].database} as ${identity.rows[0].role}`);

    for (const migration of migrations) {
      const state = await migrationState(client, migration.number);
      if (state === "applied") {
        console.log(`${migration.number}: already present; skipped`);
        continue;
      }
      const sql = await readFile(resolve(__dirname, "../migrations", migration.file), "utf8");
      try {
        // Each SQL file contains BEGIN/COMMIT, so any failed statement rolls back that file.
        await client.query(sql);
        console.log(`${migration.number}: applied`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
      if ((await migrationState(client, migration.number)) !== "applied") {
        throw new Error(`${migration.number}: post-migration schema check failed`);
      }
    }
    await client.query("NOTIFY pgrst, 'reload schema'");
    console.log("Schema cache reload requested; run npm run db:check next");
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
