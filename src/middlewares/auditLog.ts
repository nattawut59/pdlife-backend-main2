import type { RequestHandler } from "express";
import { supabase } from "../config/supabaseClient";
import type { AuditAction } from "../config/constants";

/**
 * Writes one row to audit_logs (append-only, includes failed attempts — schema §7) after the
 * response is sent. Controllers may set res.locals.auditTargetId / auditOldValue / auditNewValue
 * before responding; falls back to req.params.id for target_id.
 *
 * Reserved for state-changing actions (CREATE/UPDATE/DELETE). Do not wire this to READ routes —
 * the schema doc explicitly warns that logging every read makes audit_logs grow too fast without
 * a retention policy agreed with the DPO (schema §7 note).
 */
export function auditLog(action: AuditAction, targetTable: string): RequestHandler {
  return (req, res, next) => {
    res.on("finish", () => {
      const status = res.statusCode < 400 ? "success" : "failed";
      supabase
        .from("audit_logs")
        .insert({
          user_id: req.user?.sub ?? null,
          action,
          status,
          target_table: targetTable,
          target_id: res.locals.auditTargetId ?? req.params.id ?? null,
          old_value: res.locals.auditOldValue ?? null,
          new_value: res.locals.auditNewValue ?? null,
          ip_address: req.ip,
        })
        .then(({ error }) => {
          if (error) console.error("audit log insert failed:", error.message);
        });
    });
    next();
  };
}
