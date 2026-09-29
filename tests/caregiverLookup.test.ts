import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupCaregiverQuerySchema } from "../src/schemas/userSchema";

/**
 * ค้นผู้ดูแลจากเบอร์โทร — จุดที่พังเงียบที่สุดคือรูปแบบเบอร์
 *
 * ตอนสมัครสมาชิก เบอร์ถูกแปลงเป็น `+66...` ก่อนเก็บลง users.phone_number (ดู phoneField ใน
 * authSchema.ts) ถ้าฝั่งค้นหาไม่แปลงให้เหมือนกัน query จะไม่ match อะไรเลยและหน้าจอจะขึ้นว่า
 * "ไม่พบผู้ดูแล" ตลอดไป โดยไม่มี error ให้ใครสังเกตเห็น — เทสนี้ผูกสองฝั่งไว้ด้วยกัน
 */

function normalize(phone: string): string {
  return lookupCaregiverQuerySchema.parse({ phone }).phone;
}

test("lookup: เบอร์ที่ผู้ใช้พิมพ์แบบในชีวิตประจำวัน ต้องถูกแปลงเป็นรูปเดียวกับที่เก็บตอนสมัคร", () => {
  assert.equal(normalize("0812345678"), "+66812345678");
  assert.equal(normalize("081-234-5678"), "+66812345678");
  assert.equal(normalize("081 234 5678"), "+66812345678");
});

test("lookup: ส่ง +66 มาอยู่แล้วต้องไม่ถูกแปลงซ้ำ", () => {
  assert.equal(normalize("+66812345678"), "+66812345678");
});

test("lookup: เบอร์บ้าน 9 หลักก็ต้องรองรับ ไม่ใช่เฉพาะมือถือ", () => {
  assert.equal(normalize("021234567"), "+6621234567");
});

test("lookup: ข้อความที่ไม่ใช่เบอร์ไทยต้องถูกปฏิเสธตั้งแต่ตรวจ ไม่ปล่อยไปถึง query", () => {
  assert.throws(() => normalize("12345"));
  assert.throws(() => normalize("+1 415 555 0100"));
  assert.throws(() => normalize("ไม่ใช่เบอร์"));
});
