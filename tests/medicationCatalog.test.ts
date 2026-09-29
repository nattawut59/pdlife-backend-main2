import { test } from "node:test";
import assert from "node:assert/strict";
import { countActivePatientsByMedication } from "../src/services/medicationService";
import type { PatientMedicationRow } from "../src/types/database";

// ---------- countActivePatientsByMedication: นับผู้ป่วยไม่ซ้ำต่อยา ไม่ใช่จำนวนแถวใบสั่งยา ----------

let seq = 0;
function prescription(overrides: Partial<PatientMedicationRow>): PatientMedicationRow {
  seq += 1;
  return {
    prescription_id: `rx-${seq}`,
    patient_id: "patient-1",
    prescribed_by: "doctor-1",
    prescribed_by_name: "หมอทดสอบ",
    visit_id: null,
    medication_id: "MED-001",
    scheduled_times: ["08:00"],
    doses: { "08:00": "1 เม็ด" },
    frequency: null,
    special_instructions: null,
    active: true,
    previous_prescription_id: null,
    start_date: "2026-01-01",
    end_date: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("countActivePatientsByMedication: ยาไม่มีใบสั่งเลยไม่อยู่ในผลลัพธ์", () => {
  const counts = countActivePatientsByMedication([]);
  assert.equal(counts["MED-001"], undefined);
});

test("countActivePatientsByMedication: ผู้ป่วยคนเดียวมี 2 ใบสั่ง active ของยาเดียวกัน นับ 1 ไม่ใช่ 2", () => {
  const prescriptions = [
    prescription({ patient_id: "patient-1", medication_id: "MED-001" }),
    prescription({ patient_id: "patient-1", medication_id: "MED-001" }),
  ];
  const counts = countActivePatientsByMedication(prescriptions);
  assert.equal(counts["MED-001"], 1);
});

test("countActivePatientsByMedication: หลายผู้ป่วยหลายยา group แยกถูกยา", () => {
  const prescriptions = [
    prescription({ patient_id: "patient-1", medication_id: "MED-001" }),
    prescription({ patient_id: "patient-2", medication_id: "MED-001" }),
    prescription({ patient_id: "patient-1", medication_id: "MED-002" }),
  ];
  const counts = countActivePatientsByMedication(prescriptions);
  assert.equal(counts["MED-001"], 2);
  assert.equal(counts["MED-002"], 1);
});
