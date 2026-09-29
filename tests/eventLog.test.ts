import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyEventSeverity } from "../src/services/eventLogService";

// ---------- classifyEventSeverity: event_logs.severity (moderate/severe/critical) -> red_flags.severity (red/urgent) ----------

test("classifyEventSeverity: moderate ไม่ยิง red flag", () => {
  assert.equal(classifyEventSeverity({ severity: "moderate", required_er: false }), null);
});

test("classifyEventSeverity: severe ยิงเป็น red", () => {
  assert.equal(classifyEventSeverity({ severity: "severe", required_er: false }), "red");
});

test("classifyEventSeverity: critical ยิงเป็น urgent", () => {
  assert.equal(classifyEventSeverity({ severity: "critical", required_er: false }), "urgent");
});

test("classifyEventSeverity: required_er=true ชนะเสมอ แม้ severity แค่ moderate", () => {
  assert.equal(classifyEventSeverity({ severity: "moderate", required_er: true }), "urgent");
});

test("classifyEventSeverity: required_er=true กับ severe ก็ยังเป็น urgent ไม่ใช่ red", () => {
  assert.equal(classifyEventSeverity({ severity: "severe", required_er: true }), "urgent");
});
