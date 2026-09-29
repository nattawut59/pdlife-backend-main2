import * as auditLogRepository from "../repositories/auditLogRepository";
import { findUsersByIds } from "../repositories/userRepository";
import { ApiError } from "../utils/ApiError";
import type { JwtPayload } from "../utils/jwt";
import type { AuditLogRow, UserRow } from "../types/database";
import type { AuditAction, AuditStatus } from "../config/constants";
import type { ListAuditLogsQuery } from "../schemas/auditLogSchema";

/**
 * เปิดใช้ audit_logs ให้อ่านได้จริง — ตารางนี้ถูกเขียนมาตั้งแต่ต้น (auditLog middleware
 * ผูกอยู่ทั่ว routes) แต่ไม่เคยมีทางอ่านเลย ข้อมูลไวกว่าปกติ (เห็นได้ว่าใครแก้อะไรของใคร)
 * จึงจำกัดไว้แค่ admin ต่างจาก endpoint staff ทั่วไปที่เปิดให้ nurse/doctor/admin
 */

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  status: AuditStatus;
  target_table: string;
  target_id: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
  /** null เมื่อ user_id เป็น null (เช่น auth ล้มเหลวก่อนรู้ตัวตน) หรือบัญชีถูกลบไปแล้ว */
  actor: { id: string; name: string } | null;
}

/**
 * ประกอบแถว audit_logs กับชื่อผู้กระทำ — แยกออกจากส่วนคุย DB เพื่อเทสการจับคู่ user_id → ชื่อคน
 * ได้โดยไม่ต้องต่อฐานข้อมูล เหมือน assembleAppointments ใน appointmentService.ts
 */
export function assembleAuditLogs(
  rows: AuditLogRow[],
  users: Pick<UserRow, "id" | "first_name" | "last_name">[]
): AuditLogEntry[] {
  const userById = new Map(users.map((u) => [u.id, u]));

  return rows.map((row) => {
    const user = row.user_id ? userById.get(row.user_id) : undefined;
    return {
      id: row.id,
      action: row.action,
      status: row.status,
      target_table: row.target_table,
      target_id: row.target_id,
      old_value: row.old_value,
      new_value: row.new_value,
      created_at: row.created_at,
      actor: user ? { id: user.id, name: `${user.first_name} ${user.last_name}` } : null,
    };
  });
}

export async function list(
  requester: JwtPayload,
  query: ListAuditLogsQuery
): Promise<{ logs: AuditLogEntry[] }> {
  if (requester.role !== "admin") {
    throw new ApiError(403, "Only admins can read the audit log");
  }

  const rows = await auditLogRepository.list(query);

  const userIds = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => id !== null))];
  const users = await findUsersByIds(userIds);

  return { logs: assembleAuditLogs(rows, users) };
}
