import { Router } from "express";
import * as appointmentController from "../controllers/appointmentController";
import * as clinicAssessmentController from "../controllers/clinicAssessmentController";
import * as doctorNoteController from "../controllers/doctorNoteController";
import { requireAuth } from "../middlewares/auth";
import { requireRole } from "../middlewares/rbac";
import { validateBody, validateQuery } from "../middlewares/validate";
import { auditLog } from "../middlewares/auditLog";
import { asyncHandler } from "../utils/asyncHandler";
import {
  createAppointmentSchema,
  listAppointmentCountsQuerySchema,
  listAppointmentsQuerySchema,
  listAvailableSlotsQuerySchema,
  updateAppointmentStatusSchema,
} from "../schemas/appointmentSchema";
import { saveAssessmentSchema } from "../schemas/clinicAssessmentSchema";
import { saveDoctorNoteSchema } from "../schemas/doctorNoteSchema";

const router = Router();

router.use(requireAuth);

/**
 * ตารางนัดของทั้งคลินิกในวันหนึ่ง
 *
 * เป็น top-level ไม่ใช่ใต้ /patients/:patientId เพราะมุมมองที่ใช้จริงคือ "วันนี้ทั้งคลินิกมีใคร
 * บ้าง" ไม่ใช่ "คนนี้มีนัดวันไหนบ้าง" ส่วนนัดของผู้ป่วยรายคนเป็นคำขอคนละแบบ ค่อยเพิ่มทีหลัง
 *
 * ไม่ผูก auditLog เพราะเป็นการอ่านรายการ ไม่ใช่การเปิดเวชระเบียนรายคน
 */
router.get(
  "/",
  requireRole("nurse", "doctor", "admin"),
  validateQuery(listAppointmentsQuerySchema),
  asyncHandler(appointmentController.list)
);

/**
 * สร้างนัด — ทั้งนัดล่วงหน้าและคนที่เดินเข้ามาเอง
 *
 * ผูก auditLog เพราะเป็นการสร้างข้อมูลที่ทำให้ระบบเริ่มถามอาการผู้ป่วยรายนั้น — แถวใน
 * ตารางนี้ไม่ใช่แค่รายการปฏิทิน แต่เป็นตัวเปิดหน้าต่าง EMA ของ scheduler
 */
router.post(
  "/",
  requireRole("nurse", "doctor", "admin"),
  auditLog("CREATE", "appointments"),
  validateBody(createAppointmentSchema),
  asyncHandler(appointmentController.create)
);

/**
 * slot ว่าง/ไม่ว่างของหมอคนหนึ่งในวันหนึ่ง — ใช้ทำ picker ตอนจองนัด (ทั้งฝั่ง staff และแอปผู้ป่วย)
 *
 * ไม่กัน role เพราะไม่ใช่ข้อมูลผู้ป่วย แค่บอกว่าหมอว่างช่วงไหน ต้องเปิดให้ผู้ป่วยเรียกได้ด้วย
 * เพื่อเลือกเวลาก่อนจองนัดเอง (ดู POST /patients/:patientId/appointments)
 */
router.get(
  "/available-slots",
  validateQuery(listAvailableSlotsQuerySchema),
  asyncHandler(appointmentController.listAvailableSlots)
);

/**
 * จำนวนนัดต่อวันในช่วงหนึ่ง — ใช้วาดจุดบนปฏิทินสัปดาห์ และการ์ด "นัดที่กำลังจะถึง"
 *
 * แยกจาก GET / ที่คืนนัดทั้งใบ เพราะทั้งสองจุดที่ใช้ต้องการแค่ตัวเลข การดึงนัดทั้งสัปดาห์มาเพื่อ
 * วาดจุด 7 จุดคือการโหลดข้อมูลหลายร้อยแถวทิ้ง
 *
 * staff เท่านั้น (กันใน service) — เป็น segment คงที่ ไม่ชนกับ /:appointmentId/... ข้างล่าง
 */
router.get(
  "/counts",
  requireRole("nurse", "doctor", "admin"),
  validateQuery(listAppointmentCountsQuerySchema),
  asyncHandler(appointmentController.listDailyCounts)
);

/**
 * เปลี่ยนสถานะนัด — เช็คอิน ตรวจเสร็จ ไม่มาตามนัด ยกเลิก
 *
 * ไม่มี DELETE โดยตั้งใจ ใช้ status = cancelled แทน เพราะนัดที่หายไปจากตารางทำให้ตอบไม่ได้
 * ว่าเคยมีคนนัดไว้ไหม และฟอร์มคัดกรองที่อ้าง appointment_id อยู่จะกำพร้า
 */
router.patch(
  "/:appointmentId/status",
  requireRole("nurse", "doctor", "admin"),
  auditLog("UPDATE", "appointments"),
  validateBody(updateAppointmentStatusSchema),
  asyncHandler(appointmentController.updateStatus)
);

/**
 * ฟอร์มคัดกรองของนัดหนึ่ง
 *
 * อยู่ใต้ /appointments เพราะฟอร์มเป็นของการมาตรวจครั้งนั้น ไม่ใช่ของตัวผู้ป่วย — คนเดียวกัน
 * มาห้าครั้งต้องได้ห้าใบแยกกัน ถ้าวางไว้ใต้ /patients/:id จะเปิดช่องให้เข้าใจผิดว่ามีใบเดียว
 * ต่อคน แล้วเขียนทับกันไปเรื่อย ๆ
 *
 * ใช้ PUT ตัวเดียวไม่แยก POST/PATCH เพราะหนึ่งนัดมีได้ใบเดียวเสมอ (migration 0003 บังคับ)
 * ฝั่งเว็บจึงไม่ต้องรู้ว่ามีอยู่แล้วหรือยัง
 */
router.get(
  "/:appointmentId/assessment",
  requireRole("nurse", "doctor", "admin"),
  asyncHandler(clinicAssessmentController.getForAppointment)
);

router.put(
  "/:appointmentId/assessment",
  requireRole("nurse", "doctor", "admin"),
  auditLog("UPDATE", "clinic_assessments"),
  validateBody(saveAssessmentSchema),
  asyncHandler(clinicAssessmentController.save)
);

/**
 * แพทย์เปิดอ่านฟอร์มคัดกรองของนัดนี้
 *
 * แยกเป็น PATCH ของตัวเองแทนที่จะให้ GET ตั้งค่าให้เอง เพราะการอ่านข้อมูลไม่ควรเปลี่ยน
 * ข้อมูล — พยาบาลที่เปิดดูฟอร์มตัวเองจะกลายเป็น "แพทย์อ่านแล้ว" ทันที
 *
 * service เป็นคนกันว่าเฉพาะแพทย์เท่านั้นที่นับ ส่วน route เปิดให้ staff เรียกได้ เพราะหน้าจอ
 * เดียวกันถูกเปิดโดยทั้งสองบทบาท และการเรียกจากพยาบาลจะไม่ทำอะไรเลยแทนที่จะพัง
 */
router.patch(
  "/:appointmentId/assessment/opened",
  requireRole("nurse", "doctor", "admin"),
  asyncHandler(doctorNoteController.markAssessmentOpened)
);

/**
 * บันทึกผลการตรวจของแพทย์
 *
 * อ่านได้ทั้งคลินิก (พยาบาลต้องรู้แผนการรักษาเพื่อทำงานต่อ) แต่เขียนได้เฉพาะแพทย์ —
 * ต่างจากฟอร์มคัดกรองที่พยาบาลเป็นคนกรอก เพราะบันทึกนี้เป็นความเห็นทางการแพทย์และมี
 * การปรับยาอยู่ข้างใน
 */
router.get(
  "/:appointmentId/note",
  requireRole("nurse", "doctor", "admin"),
  asyncHandler(doctorNoteController.getForAppointment)
);

router.put(
  "/:appointmentId/note",
  requireRole("doctor", "admin"),
  auditLog("UPDATE", "doctor_notes"),
  validateBody(saveDoctorNoteSchema),
  asyncHandler(doctorNoteController.save)
);

export default router;
