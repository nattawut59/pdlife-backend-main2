import type { PostgrestError } from "@supabase/supabase-js";

/** Postgres unique_violation (23505) — surfaced by Supabase as a PostgrestError. */
export function isUniqueViolation(err: unknown): err is PostgrestError {
  return typeof err === "object" && err !== null && (err as PostgrestError).code === "23505";
}
