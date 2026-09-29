import assert from "node:assert/strict";
import { test } from "node:test";
import { registerSchema } from "../src/schemas/authSchema";

const base = {
  first_name: "สมหญิง",
  last_name: "รักดี",
  password: "S3curePass!",
  phone_number: "0898765432",
} as const;

const caregiverProfile = {
  prefix: "นาง",
  gender: "female",
  date_of_birth: "1975-05-20",
  relationship: "ลูกสาว",
  address_line: "99/1 ถนนสุขุมวิท",
  subdistrict: "คลองตัน",
  district: "วัฒนา",
  province: "กรุงเทพมหานคร",
  postal_code: "10110",
} as const;

test("patient registration ไม่ต้องกรอกฟิลด์โปรไฟล์ผู้ดูแล", () => {
  const result = registerSchema.safeParse({ ...base, role: "patient" });
  assert.equal(result.success, true);
});

test("caregiver registration ต้องกรอกฟิลด์โปรไฟล์ครบทุกตัว", () => {
  const result = registerSchema.safeParse({ ...base, role: "caregiver", ...caregiverProfile });
  assert.equal(result.success, true);
});

test("caregiver registration ที่ไม่กรอกฟิลด์โปรไฟล์เลยต้องถูกปฏิเสธ", () => {
  const result = registerSchema.safeParse({ ...base, role: "caregiver" });
  assert.equal(result.success, false);
  if (result.success) return;
  const missingFields = result.error.issues.map((issue) => issue.path[0]);
  for (const field of Object.keys(caregiverProfile)) {
    assert.ok(missingFields.includes(field), `ควรฟ้องว่าขาดฟิลด์ ${field}`);
  }
});

test("caregiver registration ที่ขาดไปแค่บางฟิลด์ต้องถูกปฏิเสธ", () => {
  const { relationship: _relationship, ...partial } = caregiverProfile;
  const result = registerSchema.safeParse({ ...base, role: "caregiver", ...partial });
  assert.equal(result.success, false);
});

test("รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลักเท่านั้น", () => {
  const result = registerSchema.safeParse({
    ...base,
    role: "caregiver",
    ...caregiverProfile,
    postal_code: "abc",
  });
  assert.equal(result.success, false);
});
