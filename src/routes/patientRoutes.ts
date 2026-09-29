import { Router } from "express";
import * as patientController from "../controllers/patientController";
import * as caregiverController from "../controllers/caregiverController";
import * as appointmentController from "../controllers/appointmentController";
import * as prescriptionController from "../controllers/prescriptionController";
import * as medicationLogController from "../controllers/medicationLogController";
import * as roundController from "../controllers/roundController";
import * as dashboardController from "../controllers/dashboardController";
import * as redFlagController from "../controllers/redFlagController";
import * as eventLogController from "../controllers/eventLogController";
import * as caregiverInviteController from "../controllers/caregiverInviteController";
import * as allergyController from "../controllers/allergyController";
import { requireAuth } from "../middlewares/auth";
import { requireRole } from "../middlewares/rbac";
import { validateBody, validateQuery } from "../middlewares/validate";
import { auditLog } from "../middlewares/auditLog";
import { caregiverInviteCreateLimiter } from "../middlewares/rateLimit";
import { asyncHandler } from "../utils/asyncHandler";
import {
  addCaregiverSchema,
  createPatientProfileSchema,
  updateCaregiverLinkSchema,
  updatePatientProfileSchema,
  createAllergySchema,
} from "../schemas/patientSchema";
import {
  createSelfAppointmentSchema,
  listPatientAppointmentsQuerySchema,
} from "../schemas/appointmentSchema";
import { createPrescriptionSchema, listMedicationLogsQuerySchema } from "../schemas/medicationSchema";
import { listRoundsQuerySchema } from "../schemas/roundSchema";
import { listRedFlagsQuerySchema } from "../schemas/redFlagSchema";
import { createEventLogSchema } from "../schemas/eventLogSchema";
import { statisticsQuerySchema, selfSummaryQuerySchema, dailyFluctuationQuerySchema } from "../schemas/statisticsSchema";

const router = Router();

router.use(requireAuth);

// -- own profile (patient only) --
router.post(
  "/me",
  requireRole("patient"),
  auditLog("CREATE", "patient_profiles"),
  validateBody(createPatientProfileSchema),
  asyncHandler(patientController.createOwnProfile)
);
router.get("/me", requireRole("patient"), asyncHandler(patientController.getOwnProfile));

// -- clinic patient list (staff only) --
router.get(
  "/",
  requireRole("nurse", "doctor", "admin"),
  asyncHandler(patientController.listPatients)
);

// -- profile by id (self / linked caregiver / staff — checked in service) --
router.post(
  "/:userId",
  requireRole("nurse", "doctor", "admin"),
  auditLog("CREATE", "patient_profiles"),
  validateBody(createPatientProfileSchema),
  asyncHandler(patientController.createProfileFor)
);
router.get("/:userId", asyncHandler(patientController.getProfile));
router.patch(
  "/:userId",
  auditLog("UPDATE", "patient_profiles"),
  validateBody(updatePatientProfileSchema),
  asyncHandler(patientController.updateProfile)
);

router.get("/:patientId/allergies", asyncHandler(allergyController.list));
router.post(
  "/:patientId/allergies",
  auditLog("CREATE", "patient_allergies"),
  validateBody(createAllergySchema),
  asyncHandler(allergyController.add)
);
router.delete(
  "/:patientId/allergies/:allergyId",
  auditLog("DELETE", "patient_allergies"),
  asyncHandler(allergyController.remove)
);

// -- caregiver links --
router.post(
  "/:patientId/caregivers",
  auditLog("CREATE", "patient_caregivers"),
  validateBody(addCaregiverSchema),
  asyncHandler(caregiverController.linkCaregiver)
);
router.get("/:patientId/caregivers", asyncHandler(caregiverController.listCaregivers));
router.get(
  "/:patientId/caregivers/:caregiverId",
  asyncHandler(caregiverController.getCaregiver)
);
router.patch(
  "/:patientId/caregivers/:linkId",
  auditLog("UPDATE", "patient_caregivers"),
  validateBody(updateCaregiverLinkSchema),
  asyncHandler(caregiverController.updateCaregiverLink)
);

// -- รหัสเชิญ 6 หลัก — ผู้ป่วยเอง หรือผู้ดูแลที่ผูกอยู่แล้ว สร้างรหัสให้ผู้ดูแลใหม่พิมพ์
// (สิทธิ์เช็คใน service ผ่าน assertCanAccessPatient เหมือน endpoint อื่นใต้ /patients/:id)
// ดู /caregiver-invites/:code สำหรับขั้นดู/ยืนยันฝั่งผู้ดูแลที่ได้รับเชิญ
router.post(
  "/:patientId/caregiver-invites",
  caregiverInviteCreateLimiter,
  asyncHandler(caregiverInviteController.create)
);

// -- self-booking (nested under patient) — งานฉุกเฉิน/walk-in ยังต้องผ่าน staff ที่ /api/appointments เท่านั้น
router.post(
  "/:patientId/appointments",
  requireRole("patient", "caregiver"),
  auditLog("CREATE", "appointments"),
  validateBody(createSelfAppointmentSchema),
  asyncHandler(appointmentController.createSelfBooking)
);

/**
 * นัดของผู้ป่วยรายนี้ — ไม่กันด้วย requireRole เพราะ staff ก็ต้องเรียกได้เหมือน
 * endpoint อื่นใต้ /patients/:id (สิทธิ์จริงตรวจใน service ด้วย assertCanAccessPatient)
 */
router.get(
  "/:patientId/appointments",
  validateQuery(listPatientAppointmentsQuerySchema),
  asyncHandler(appointmentController.listForPatient)
);

// -- prescriptions (nested under patient) --
// admin รวมอยู่ด้วยตามคำขอ (2026-09) — เดิมจำกัดแค่ doctor/nurse เพราะเป็นคำสั่งทางคลินิก
// ผู้ใช้ยืนยันแล้วว่าต้องการให้ admin สั่งยาได้จริง ไม่ใช่แค่ทางลัดตอนทดสอบ
router.post(
  "/:patientId/prescriptions",
  requireRole("doctor", "nurse", "admin"),
  auditLog("CREATE", "patient_medications"),
  validateBody(createPrescriptionSchema),
  asyncHandler(prescriptionController.create)
);
router.get("/:patientId/prescriptions", asyncHandler(prescriptionController.list));

// -- medication logs (nested under patient, read-only here — writes are top-level) --
router.get(
  "/:patientId/medication-logs",
  validateQuery(listMedicationLogsQuerySchema),
  asyncHandler(medicationLogController.list)
);
router.get(
  "/:patientId/statistics",
  validateQuery(statisticsQuerySchema),
  asyncHandler(patientController.getStatistics)
);
router.get(
  "/:patientId/self-summary",
  validateQuery(selfSummaryQuerySchema),
  asyncHandler(patientController.getSelfSummary)
);
router.get(
  "/:patientId/daily-fluctuation",
  validateQuery(dailyFluctuationQuerySchema),
  asyncHandler(patientController.getDailyFluctuation)
);

// -- event logs (§6.3 — เหตุฉุกเฉินนอกรอบคำถาม) เขียนได้เฉพาะผู้ป่วยเอง/ผู้ดูแลที่มีสิทธิ์ตอบแทน
// เจ้าหน้าที่คีย์แทนเป็นงานคนละสโคป ยังไม่ทำรอบนี้
router.post(
  "/:patientId/event-logs",
  requireRole("patient", "caregiver"),
  auditLog("CREATE", "event_logs"),
  validateBody(createEventLogSchema),
  asyncHandler(eventLogController.create)
);
router.get("/:patientId/event-logs", asyncHandler(eventLogController.list));

// -- rounds (nested under patient, read-only here — creation/answers are top-level under /rounds) --
router.get(
  "/:patientId/rounds",
  validateQuery(listRoundsQuerySchema),
  asyncHandler(roundController.listForPatient)
);

// -- dashboard (C1/C2/C3) — staff-only; patient self-view is FR P8, explicitly phase-2 --
router.get(
  "/:patientId/dashboard/timeline",
  requireRole("nurse", "doctor", "admin"),
  asyncHandler(dashboardController.getTimeline)
);
router.get(
  "/:patientId/dashboard/summary",
  requireRole("nurse", "doctor", "admin"),
  asyncHandler(dashboardController.getSummary)
);
router.get(
  "/:patientId/dashboard/warnings",
  requireRole("nurse", "doctor", "admin"),
  asyncHandler(dashboardController.getWarnings)
);
// -- ตารางเทียบ "แอป vs พยาบาล" — คำตอบล่าสุดของผู้ป่วยในแอป แปลงให้ตรงกับ 26 ข้อของฟอร์มคัดกรอง
router.get(
  "/:patientId/dashboard/app-answers",
  requireRole("nurse", "doctor", "admin"),
  asyncHandler(dashboardController.getAppAnswers)
);
// -- red flags (§9.4/§9.5) — staff-only เท่ากับ dashboard
//
// จงใจไม่ให้ผู้ป่วยดูธงของตัวเอง: ธงที่ยิงบ่อยที่สุดคือ suicidal_ideation การเด้งกลับไปบอก
// ผู้ป่วยว่าระบบทำเครื่องหมายไว้ว่าเสี่ยง เป็นอันตรายทางคลินิก ไม่ใช่ความโปร่งใส
// สิ่งที่ผู้ป่วยควรเห็นคือสายด่วน 1323 ซึ่งเป็นหน้าที่ของฝั่งแอป ไม่ใช่ endpoint นี้
//
// ไม่ผูก auditLog เพราะเป็น READ — schema §7 เตือนไว้ว่าการ log ทุกการอ่านจะทำให้
// audit_logs โตเร็วเกินไปโดยยังไม่มี retention policy ที่ตกลงกับ DPO
router.get(
  "/:patientId/red-flags",
  requireRole("nurse", "doctor", "admin"),
  validateQuery(listRedFlagsQuerySchema),
  asyncHandler(redFlagController.listForPatient)
);

router.get(
  "/:patientId/dashboard/visit-comparison/:appointmentId",
  requireRole("nurse", "doctor", "admin"),
  asyncHandler(dashboardController.getVisitComparison)
);

export default router;
