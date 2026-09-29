/**
 * Mirrors the Postgres ENUM types created in migrations/0001_init_schema.sql (schema §10).
 * Keep in sync with the DDL — do not add/remove values here without a matching migration.
 */
import type { StructuredRedFlagRule } from "../types/database";

export const USER_ROLES = ["patient", "caregiver", "nurse", "doctor", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const LANG_CODES = ["th", "en"] as const;
export type LangCode = (typeof LANG_CODES)[number];

export const GENDER_TYPES = ["male", "female", "other"] as const;
export type GenderType = (typeof GENDER_TYPES)[number];

export const DIAGNOSIS_TYPES = ["PD", "Prodromal", "Control", "Other"] as const;
export type DiagnosisType = (typeof DIAGNOSIS_TYPES)[number];

export const PLATFORM_TYPES = ["ios", "android", "web"] as const;
export type PlatformType = (typeof PLATFORM_TYPES)[number];

export const ROUND_STATUSES = ["pending", "completed", "missed", "expired"] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

export const RESPONDENT_ROLES = ["patient", "caregiver"] as const;
export type RespondentRole = (typeof RESPONDENT_ROLES)[number];

export const EVENT_TYPES = [
  "choking",
  "severe_dyskinesia",
  "medication_no_effect",
  "emergency_other",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const SEVERITIES = ["moderate", "severe", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ONOFF_STATES = ["on", "off", "unknown"] as const;
export type OnOffState = (typeof ONOFF_STATES)[number];

export const MED_STATUSES = ["active", "discontinued", "unavailable"] as const;
export type MedStatus = (typeof MED_STATUSES)[number];

export const MED_LOG_STATUSES = ["pending", "taken", "skipped"] as const;
export type MedLogStatus = (typeof MED_LOG_STATUSES)[number];

export const VISIT_TYPES = ["routine", "follow_up", "urgent", "walk_in"] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

export const VISIT_STATUSES = [
  "scheduled",
  "checked_in",
  "completed",
  "missed",
  "cancelled",
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const ASSESS_STATUSES = ["draft", "submitted", "doctor_opened"] as const;
export type AssessStatus = (typeof ASSESS_STATUSES)[number];

export const URGENCIES = ["routine", "soon", "urgent"] as const;
export type Urgency = (typeof URGENCIES)[number];

export const NOTIF_TYPES = [
  "medication_reminder",
  "round_reminder",
  "previsit_reminder",
  "reminder_2days",
  "reminder_1day",
] as const;
export type NotifType = (typeof NOTIF_TYPES)[number];

export const NOTIF_TRIGGERS = ["after_submit", "system"] as const;
export type NotifTrigger = (typeof NOTIF_TRIGGERS)[number];

export const DELIVERY_STATUSES = ["queued", "sent", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const FLAG_SEVERITIES = ["red", "urgent"] as const;
export type FlagSeverity = (typeof FLAG_SEVERITIES)[number];

export const AUDIT_ACTIONS = ["READ", "CREATE", "UPDATE", "DELETE"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_STATUSES = ["success", "failed"] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

/** question_bank.respondent — plain VARCHAR in DB (not a Postgres ENUM), constrained at app level. */
export const RESPONDENT_POLICIES = ["patient_only", "caregiver_preferred", "both"] as const;
export type RespondentPolicy = (typeof RESPONDENT_POLICIES)[number];

/** question_bank.required_level — plain VARCHAR in DB. */
export const REQUIRED_LEVELS = ["core", "optional", "conditional"] as const;
export type RequiredLevel = (typeof REQUIRED_LEVELS)[number];

/** question_bank.mvp_phase / checkin_templates.mvp_phase — plain VARCHAR in DB. */
export const MVP_PHASES = ["MVP1", "MVP2"] as const;
export type MvpPhase = (typeof MVP_PHASES)[number];

/** checkin_templates.template_code — the 7 fixed rounds from the Question Bank. */
export const TEMPLATE_CODES = [
  "POST_MED_MICRO",
  "PRE_NEXT_MED_MICRO",
  "MORNING_CHECKIN",
  "EVENING_DAILY_CORE",
  "WEEKLY_CHECKIN",
  "PREVISIT_7D_FORM",
  "ADHOC_CONCERN",
] as const;
export type TemplateCode = (typeof TEMPLATE_CODES)[number];

/**
 * นิยาม "คิวว่าง" ของนัดหมาย — เอกสาร requirements ต้นทาง (PDLIFE_Functional_Requirements.docx)
 * ไม่มีเรื่องนี้เขียนไว้เลยแม้แต่บรรทัดเดียว (เช็คแล้ว ไม่ได้เดา) ค่าพวกนี้จึงเป็นการตัดสินใจ
 * ของทีมเอง ไม่ใช่ค่าที่มีสเปกอยู่แล้ว — ปรับได้ทีหลังถ้าฝ่ายคลินิกจริงให้ค่าที่ต่างจากนี้
 *
 * โมเดล: หมอ 1 คน 1 ช่วงเวลา รับได้ 1 นัด (ไม่ใช่แค่กันชนกันแบบหลวมๆ) — บังคับจริงที่
 * migrations/0005_one_appointment_per_doctor_slot.sql ค่าที่นี่ใช้แค่ตรวจรูปแบบเวลาที่ส่งเข้ามา
 * ว่าตรง slot boundary ก่อนถึงชั้นฐานข้อมูล (ดู isValidSlotTime ใน schemas/appointmentSchema.ts)
 */
export const APPOINTMENT_SLOT_MINUTES = 30;
export const CLINIC_OPEN_TIME = "08:00";
export const CLINIC_CLOSE_TIME = "17:00";

/**
 * MOT-05 (MOTOR_FALL_NEAR_FALL) ข้อความจริงในคำถามคือ "เกือบล้มซ้ำ" — ยืนยันกับทีมแล้วว่า
 * "ซ้ำ" หมายถึงจำนวนครั้ง (answer_value.count) ในวันเดียวกัน ไม่ใช่ข้ามวัน (เดิมเข้าใจผิด)
 * ดู checkFallNearFallRule ใน redFlagService.ts
 */
export const NEAR_FALL_REPEAT_THRESHOLD = 2;

/**
 * 26 อาการในฟอร์มคัดกรองของพยาบาล — ชื่อตรงกับคอลัมน์ใน clinic_assessments ทุกตัว
 *
 * ที่เดียวที่เก็บรายชื่อนี้ไว้ ทั้ง zod schema และการเขียนลงฐานข้อมูลอ่านจากตรงนี้ — ถ้าแยกกัน
 * เขียน วันหนึ่งจะเพิ่มอาการใหม่ที่ผ่าน validation แต่ไม่ถูกบันทึก หรือกลับกัน
 *
 * ลำดับตรงกับฟอร์มกระดาษที่คลินิกใช้อยู่ ไม่ใช่เรียงตามตัวอักษร
 */
export const ASSESSMENT_ITEM_KEYS = [
  // Motor (4)
  "motor_tremor",
  "motor_rigidity",
  "motor_bradykinesia",
  "motor_gait_dysfunction",
  // Speech (1)
  "speech_swallowing",
  // GI (3)
  "gi_drooling",
  "gi_dysphagia",
  "gi_constipation",
  // ANS (3)
  "ans_oh",
  "ans_urinary",
  "ans_sexual",
  // Sleep (4)
  "sleep_insomnia",
  "sleep_rbd",
  "sleep_nocturia",
  "sleep_eds",
  // Neuropsychiatric (5)
  "neuro_anxiety",
  "neuro_depression",
  "neuro_hallucination",
  "neuro_dementia",
  "neuro_icds",
  // Motor fluctuation (6)
  "mf_wearing_off",
  "mf_delay_on",
  "mf_suboptimal_on",
  "mf_early_morning_off",
  "mf_dyskinesia",
  "mf_nocturnal_hypokinesia",
] as const;
export type AssessmentItemKey = (typeof ASSESSMENT_ITEM_KEYS)[number];

/**
 * ข้อไหนในฟอร์มคัดกรอง 26 ข้อ ตรงกับคำถามไหนที่แอปถามผู้ป่วยอยู่แล้ว — ใช้ทำตาราง
 * เทียบ "แอป vs พยาบาล" (docs/HANDOVER.md ข้อ 5.1)
 *
 * ยืนยันจาก docs/PDLIFE_Question_Bank_master_v1.xlsx (seed/seed.sql) โดยเทียบข้อความ label
 * ของ options_json กับ mock-assessment.ts ฝั่งเว็บทีละคู่ ไม่ได้เดา — บางข้อความตรงกันเป๊ะ
 * ยืนยันว่า mapping นี้เป็นสิ่งที่ทีมตั้งใจไว้ตั้งแต่แรก
 *
 * motor_rigidity / motor_bradykinesia เป็น null เพราะแอปไม่เคยถามสองข้อนี้เลย — ต้องแยกให้
 * ออกจาก "ถามแล้วตอบว่าไม่มี" ในตารางเทียบ ไม่งั้นจะถูกนับเป็น "ไม่ตรงกัน" ทั้งที่เทียบไม่ได้
 *
 * mf_delay_on กับ mf_suboptimal_on มาจากคำถามเดียวกัน (MED_DELAYED_OR_SUBOPTIMAL_ON) —
 * ตัวคำตอบ (code c1/c2/c3) เป็นตัวแยกว่า flag ข้อไหนบ้าง ดู appAssessmentService
 */
export const ASSESSMENT_KEY_QUESTION_CODES: Record<AssessmentItemKey, string | null> = {
  motor_tremor: "MOTOR_TREMOR_IMPACT",
  motor_rigidity: null,
  motor_bradykinesia: null,
  motor_gait_dysfunction: "MOTOR_WALK_BALANCE",
  speech_swallowing: "ADL_SPEECH_CLARITY",
  gi_drooling: "ADL_DROOLING",
  gi_dysphagia: "ADL_SWALLOWING",
  gi_constipation: "AUTO_CONSTIPATION",
  ans_oh: "AUTO_ORTHOSTATIC_SYMPTOM",
  ans_urinary: "AUTO_URINARY_SYMPTOM",
  ans_sexual: "AUTO_SEXUAL_CONCERN",
  sleep_insomnia: "SLEEP_QUALITY",
  sleep_rbd: "SLEEP_RBD_OBSERVED",
  sleep_nocturia: "SLEEP_NOCTURIA",
  sleep_eds: "SLEEP_DAYTIME_SLEEPINESS",
  neuro_anxiety: "MOOD_ANXIETY",
  neuro_depression: "MOOD_DEPRESSED_ANHEDONIA",
  neuro_hallucination: "COG_HALLUCINATION",
  neuro_dementia: "COG_MEMORY",
  neuro_icds: "MOOD_IMPULSE_CONTROL",
  mf_wearing_off: "MED_WEARING_OFF",
  mf_delay_on: "MED_DELAYED_OR_SUBOPTIMAL_ON",
  mf_suboptimal_on: "MED_DELAYED_OR_SUBOPTIMAL_ON",
  mf_early_morning_off: "MED_EARLY_MORNING_OFF",
  mf_dyskinesia: "MED_DYSKINESIA_TODAY",
  mf_nocturnal_hypokinesia: "SLEEP_IMMOBILITY_AT_NIGHT",
};

/** คำถามเดียวที่ต้องแยกเป็นสองข้อในฟอร์มพยาบาล — ดู ASSESSMENT_KEY_QUESTION_CODES ด้านบน */
export const DELAY_OR_SUBOPTIMAL_QUESTION_CODE = "MED_DELAYED_OR_SUBOPTIMAL_ON";

/**
 * คำถามที่ตัวเลือก "ไม่มีอาการ" ไม่ใช่ code "no"/"none" ตามปกติ (isNonBaseline ใน
 * appAssessmentService เช็คแค่สองค่านี้เป็นค่าเริ่มต้น) — key: question_code, value: choice
 * ที่แปลว่าไม่มีอาการจริง ยืนยันจาก options_json ใน seed/seed.sql
 *
 * เจอระหว่างเขียน seed ทดสอบ: SLEEP_NOCTURIA เป็น single_choice นับจำนวนครั้ง (c1="0"
 * ไปจนถึง c5="4 ครั้งขึ้นไป") ไม่ใช่ yes/no — ถ้าไม่มีรายการนี้ "c1" (ไม่มีอาการจริง) จะถูก
 * นับเป็น flagged ผิดพลาด เพราะ "c1" ไม่ใช่ "no"/"none"
 */
/**
 * ค่า structured แทน question_bank.red_flag_json.rule สำหรับคำถาม severity red/urgent —
 * เจอว่าทั้ง 12 ข้อในระบบ (docs/HANDOVER.md ข้อ 5.2) เป็นข้อความอิสระ 100% ไม่มีข้อไหนเป็น
 * {operator,value,field} ที่ evaluateStructuredRule อ่านได้เลย แปลว่า red flag เกือบทั้งหมด
 * ไม่เคยยิงจริง (ยกเว้น MOOD_SUICIDAL_IDEATION ที่ไม่ผ่านทางนี้ — hardcode แยกเป็น
 * checkMoodSafetyGate อยู่แล้ว จึงไม่อยู่ในตารางนี้)
 *
 * ทุกค่าที่นี่ transcribe ตรงจากข้อความ rule จริงใน seed/seed.sql ไม่ได้ตีความหรือเดา —
 * ข้อความต้นฉบับอยู่ใน comment ต่อรายการ ยึดหลักเดียวกับ FALL_QUESTION/OH_QUESTION ใน
 * dashboardService.ts และ MOOD_SUICIDAL_QUESTION_CODE ใน redFlagService.ts
 *
 * 2 ข้อ (AUTO_ORTHOSTATIC_SYMPTOM, MOTOR_FALL_NEAR_FALL) มีเงื่อนไข "เกิดซ้ำข้ามวัน/ข้ามคำถาม"
 * ในข้อความต้นฉบับที่ตัดออกไปก่อน เพราะ evaluateStructuredRule ประเมินจากคำตอบเดียว ไม่มี
 * context ประวัติคำตอบข้ามเวลา — ตัดสินใจร่วมกับทีมแล้วว่าให้ยิงส่วนที่ทำได้ก่อน ส่วนที่เหลือ
 * เป็น backlog ใหม่ (ดู docs/HANDOVER.md)
 */
export const STRUCTURED_RULE_OVERRIDES: Record<string, StructuredRedFlagRule> = {
  // "score >= 3"
  MED_DYSKINESIA_IMPACT: { operator: ">=", value: 3, field: "score" },
  // "score >= 3"
  MOTOR_WALK_BALANCE: { operator: ">=", value: 3, field: "score" },
  // "score >= 3"
  MOTOR_TREMOR_IMPACT: { operator: ">=", value: 3, field: "score" },
  // "score >= 3"
  MOOD_DEPRESSED_ANHEDONIA: { operator: ">=", value: 3, field: "score" },
  // "score >= 3"
  MOOD_ANXIETY: { operator: ">=", value: 3, field: "score" },
  // "score >= 2"
  ADL_SWALLOWING: { operator: ">=", value: 2, field: "score" },
  // "มี และไม่แน่ใจว่าจริงหรือไม่" — ตรงกับ label ของ option code "c2" เป๊ะ
  COG_HALLUCINATION: { operator: "==", value: "c2" },
  // "answer_code in [some, clear]" — เป็น machine-readable อยู่แล้วในต้นฉบับ
  COG_DELUSION: { operator: "in", value: ["some", "clear"] },
  // "บาดเจ็บที่ต้องพบแพทย์" — ตรงกับ label ของ option code "medical_attention" เป๊ะ
  MOTOR_FALL_INJURY: { operator: "==", value: "medical_attention" },
  // เดิม "score >= 2 (เกิดซ้ำ) OR answer_code in [near_faint, faint] OR paired with MOT-05
  // same day" — near_faint/faint มี score 3/4 อยู่แล้วจึงถูกครอบด้วย score>=2 ส่วน "paired with
  // MOT-05 same day" แยกไปเป็น checkOrthostaticPairedWithFall ใน redFlagService.ts (OR กับ
  // entry นี้) เพราะต้องเทียบกับคำตอบข้อ MOT-05 ในรอบเดียวกัน ไม่ใช่รูปแบบ {operator,value,field}
  // เดี่ยวที่ระบบนี้รองรับ
  AUTO_ORTHOSTATIC_SYMPTOM: { operator: ">=", value: 2, field: "score" },
  // MOTOR_FALL_NEAR_FALL ("ล้มจริงๆ หรือ เกือบล้มซ้ำ") ไม่อยู่ในตารางนี้แล้ว — ย้ายไปเป็น
  // checkFallNearFallRule ใน redFlagService.ts ทั้งหมด เพราะกติกาเป็น OR ของสอง field
  // (choice=="fall_real" OR (choice=="near_fall" AND count>=2)) ซึ่งรูปแบบ {operator,value,field}
  // เดี่ยวของตารางนี้รองรับไม่ได้
};

export const NON_STANDARD_BASELINE_CHOICE: Record<string, string> = {
  SLEEP_NOCTURIA: "c1",
};
