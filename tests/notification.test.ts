import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExpoPushMessage, collapseDeviceDuplicates } from "../src/services/notificationService";

test("push payload requests audible high-priority delivery on the app channel", () => {
  const message = buildExpoPushMessage(
    { expo_push_token: "ExponentPushToken[test]" },
    { title: "ถึงเวลากินยา", body: "เลโวโดปา", data: { medication_log_id: "log-1" } }
  );

  assert.equal(message.sound, "default");
  assert.equal(message.priority, "high");
  assert.equal(message.channelId, "pdlife-reminders");
  assert.deepEqual(message.data, { medication_log_id: "log-1" });
});
import type { NotificationRow } from "../src/types/database";

/**
 * ตาราง notifications เป็น delivery log — notify() เขียน 1 แถวต่อ 1 อุปกรณ์ที่ยิงไป
 * ผู้ใช้ที่มีสองเครื่อง (หรือเคยลงแอปใหม่จน device row เก่าค้าง) จึงมีหลายแถวของเรื่องเดียวกัน
 * เทสนี้กันไม่ให้รายละเอียดการส่งของเรารั่วไปเป็นรายการซ้ำในแอป
 */

function row(over: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "n1",
    user_id: "u1",
    patient_id: "p1",
    device_id: "d1",
    round_instance_id: null,
    prescription_id: null,
    medication_log_id: null,
    appointment_id: null,
    type: "medication_reminder",
    trigger_type: "system",
    questions_remaining: null,
    triggered_at: "2026-09-08T08:00:00.000Z",
    sent_at: null,
    delivery_status: "sent",
    is_read: false,
    created_at: "2026-09-08T08:00:00.000Z",
    ...over,
  };
}

test("collapseDeviceDuplicates: เรื่องเดียวกันที่ยิงไปสองอุปกรณ์ เหลือรายการเดียว", () => {
  const rows = [
    row({ id: "n1", device_id: "phone", medication_log_id: "m1" }),
    row({ id: "n2", device_id: "tablet", medication_log_id: "m1" }),
  ];
  assert.equal(collapseDeviceDuplicates(rows).length, 1);
});

test("collapseDeviceDuplicates: เวลาต่างกันระดับมิลลิวินาทีในนาทีเดียวกัน ยังนับเป็นเรื่องเดียว", () => {
  const rows = [
    row({ id: "n1", device_id: "phone", triggered_at: "2026-09-08T08:00:00.120Z" }),
    row({ id: "n2", device_id: "tablet", triggered_at: "2026-09-08T08:00:00.480Z" }),
  ];
  assert.equal(collapseDeviceDuplicates(rows).length, 1);
});

test("collapseDeviceDuplicates: คนละมื้อยา ต้องไม่ถูกยุบรวมกัน", () => {
  const rows = [
    row({ id: "n1", medication_log_id: "m1" }),
    row({ id: "n2", medication_log_id: "m2" }),
  ];
  assert.equal(collapseDeviceDuplicates(rows).length, 2);
});

test("collapseDeviceDuplicates: คนละชนิดการแจ้งเตือนในนาทีเดียวกัน ต้องไม่ถูกยุบรวมกัน", () => {
  const rows = [row({ id: "n1", type: "medication_reminder" }), row({ id: "n2", type: "round_reminder" })];
  assert.equal(collapseDeviceDuplicates(rows).length, 2);
});

test("collapseDeviceDuplicates: อ่านบนเครื่องเดียว ถือว่าอ่านแล้วทั้งเรื่อง", () => {
  const rows = [
    row({ id: "n1", device_id: "phone", is_read: false }),
    row({ id: "n2", device_id: "tablet", is_read: true }),
  ];
  const [collapsed] = collapseDeviceDuplicates(rows);
  assert.equal(collapsed.is_read, true, "ไม่งั้นผู้ใช้จะเห็นเรื่องที่กดอ่านไปแล้วค้างเป็นยังไม่อ่าน");
});

test("collapseDeviceDuplicates: เก็บแถวใหม่สุดเป็นตัวแทน (repository เรียงใหม่→เก่ามาแล้ว)", () => {
  const rows = [
    row({ id: "newest", device_id: "phone" }),
    row({ id: "older", device_id: "tablet" }),
  ];
  assert.equal(collapseDeviceDuplicates(rows)[0].id, "newest");
});

test("collapseDeviceDuplicates: ไม่มีแถวเลย ต้องได้ array ว่าง ไม่ใช่พัง", () => {
  assert.deepEqual(collapseDeviceDuplicates([]), []);
});
