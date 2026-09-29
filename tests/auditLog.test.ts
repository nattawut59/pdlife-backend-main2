import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleAuditLogs } from "../src/services/auditLogService";
import type { AuditLogRow, UserRow } from "../src/types/database";

function row(overrides: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    id: "log-1",
    user_id: "user-1",
    action: "UPDATE",
    status: "success",
    target_table: "appointments",
    target_id: "appt-1",
    old_value: null,
    new_value: { status: "checked_in" },
    ip_address: null,
    created_at: "2026-09-01T09:00:00.000Z",
    ...overrides,
  };
}

function user(overrides: Partial<UserRow> = {}): Pick<UserRow, "id" | "first_name" | "last_name"> {
  return { id: "user-1", first_name: "กาญจนา", last_name: "ดวงแก้ว", ...overrides };
}

test("assembleAuditLogs: จับคู่ user_id กับชื่อคนถูกต้อง", () => {
  const [entry] = assembleAuditLogs([row()], [user()]);
  assert.deepEqual(entry.actor, { id: "user-1", name: "กาญจนา ดวงแก้ว" });
});

test("assembleAuditLogs: user_id เป็น null (เช่น auth ล้มเหลวก่อนรู้ตัวตน) ได้ actor เป็น null", () => {
  const [entry] = assembleAuditLogs([row({ user_id: null })], [user()]);
  assert.equal(entry.actor, null);
});

test("assembleAuditLogs: บัญชีถูกลบไปแล้ว (มี user_id แต่หาไม่เจอในรายชื่อ) ได้ actor เป็น null ไม่ใช่พัง", () => {
  const [entry] = assembleAuditLogs([row({ user_id: "user-deleted" })], [user()]);
  assert.equal(entry.actor, null);
});

test("assembleAuditLogs: หลายแถวไม่ยัดชื่อของคนอื่นผิดคน", () => {
  const rows = [
    row({ id: "log-1", user_id: "user-1" }),
    row({ id: "log-2", user_id: "user-2" }),
  ];
  const users = [user({ id: "user-1", first_name: "กาญจนา" }), user({ id: "user-2", first_name: "สมศักดิ์" })];

  const result = assembleAuditLogs(rows, users);
  assert.equal(result[0].actor?.name, "กาญจนา ดวงแก้ว");
  assert.equal(result[1].actor?.name, "สมศักดิ์ ดวงแก้ว");
});

test("assembleAuditLogs: คงค่า action/status/target_table/target_id/old_value/new_value ไว้ครบ", () => {
  const [entry] = assembleAuditLogs(
    [row({ action: "DELETE", status: "failed", old_value: { a: 1 }, new_value: null })],
    [user()]
  );
  assert.equal(entry.action, "DELETE");
  assert.equal(entry.status, "failed");
  assert.deepEqual(entry.old_value, { a: 1 });
  assert.equal(entry.new_value, null);
});
