/**
 * TypeScript row types mirroring migrations/0001_init_schema.sql, which is a verbatim
 * transcription of PD_Life_Schema_v3_Complete.pdf §10. Do not add fields that aren't in
 * that DDL — if the schema needs to change, change the migration first, then this file.
 */
import type {
  AssessStatus,
  AuditAction,
  AuditStatus,
  DeliveryStatus,
  DiagnosisType,
  EventType,
  FlagSeverity,
  GenderType,
  LangCode,
  MedLogStatus,
  MedStatus,
  MvpPhase,
  NotifTrigger,
  NotifType,
  OnOffState,
  PlatformType,
  RequiredLevel,
  RespondentPolicy,
  RespondentRole,
  RoundStatus,
  Severity,
  UserRole,
  Urgency,
  VisitStatus,
  VisitType,
} from "../config/constants";

/** question_bank.options_json entries. Key is `code` (choice/single/multi) or `value` (yes_no). */
export interface QuestionOption {
  code?: string;
  value?: string;
  label: string;
  score: number | null;
}

/** question_bank.condition_json / template_questions.condition_json — §9.2 flow-engine format. */
export interface ConditionJson {
  show_if?: {
    question_code: string;
    operator: "in" | "not_in" | ">=" | "<=" | "==";
    value: string[] | number | string;
    field?: "choice" | "score";
    note?: string;
  };
}

/**
 * question_bank.red_flag_json — §9.5 warning-level rules (not written to red_flags table).
 * `rule` has no fixed shape in the source docs: today's seed data carries a free-text string
 * meant for a human to read, not a machine-evaluable expression, so it's typed `unknown`
 * rather than `string` — code must not assume a shape the schema doesn't actually specify.
 */
export interface RedFlagRule {
  rule?: unknown;
  window?: string;
  severity?: "warning" | "red" | "urgent";
  clinic_tag?: string;
  note?: string;
  in_app_action?: string;
}

/**
 * รูปแบบ machine-evaluable ของ red_flag_json.rule ตาม §9.2 — ข้อมูลจริงเกือบทั้งหมดยังเป็น
 * ข้อความอิสระ ไม่ใช่รูปนี้ (ดู STRUCTURED_RULE_OVERRIDES ใน config/constants.ts) แยก type
 * ออกมาให้มีชื่อ เพราะใช้ทั้งใน evaluateStructuredRule และตาราง override นั้น
 */
export interface StructuredRedFlagRule {
  operator: ">=" | "<=" | "==" | "in" | "not_in";
  value: string | number | string[];
  field?: "choice" | "score";
}

/** responses.answer_value — shape varies by question_bank.answer_type. */
export interface AnswerValue {
  choice?: string;
  score?: number | null;
  /** เฉพาะ answer_type "single_choice_with_count" — จำนวนครั้งที่เกิดเหตุการณ์ในวันนั้น */
  count?: number;
  /** เฉพาะ answer_type "single_choice_with_text" — รายละเอียดที่ผู้ตอบระบุเพิ่ม */
  text?: string;
  [key: string]: unknown;
}

// ========== 1) USERS & ACCESS ==========

export interface UserRow {
  id: string;
  auth_uid: string | null;
  first_name: string;
  last_name: string;
  user_name: string;
  role: UserRole;
  phone_number: string | null;
  password_hash: string | null;
  preferred_language: LangCode;
  last_login_at: string | null;
  is_active: boolean;
  deactivated_at: string | null;
  app_version: string | null;
  created_at: string;
}

export interface PatientProfileRow {
  user_id: string;
  id_card_number: string | null;
  hn_number: string | null;
  gender: GenderType | null;
  date_of_birth: string;
  // age is NOT a column here (schema v3.3 §1.2 dropped it — age() isn't IMMUTABLE, a STORED
  // generated column would go stale). It's computed live in v_patient_full -> PatientFullRow.
  diagnosis_date: string | null;
  diagnosis: DiagnosisType | null;
  other_diagnosis: string | null;
  hoehn_yahr_stage: number | null;
  wake_time: string;
  sleep_time: string;
  province: string | null;
  registered_at: string;
}

export interface CaregiverProfileRow {
  user_id: string;
  prefix: string;
  gender: GenderType;
  date_of_birth: string;
  // ค่าเริ่มต้นตอนสมัคร ไม่ใช่ตัวเดียวกับ PatientCaregiverRow.relationship (ผูกกับผู้ป่วยแต่ละคนแยกกัน)
  relationship: string;
  address_line: string;
  subdistrict: string;
  district: string;
  province: string;
  postal_code: string;
  created_at: string;
}

export interface PatientCaregiverRow {
  id: string;
  patient_id: string;
  caregiver_id: string;
  relationship: string | null;
  can_answer: boolean;
  is_primary: boolean;
  active: boolean;
  created_at: string;
}

export interface PatientAllergyRow {
  id: string;
  patient_id: string;
  substance: string;
  created_by: string;
  created_at: string;
}

export interface CaregiverInviteRow {
  id: string;
  patient_id: string;
  code: string;
  created_by: string;
  expires_at: string;
  redeemed_at: string | null;
  redeemed_by: string | null;
  created_at: string;
}

export interface DeviceRow {
  id: string;
  user_id: string;
  expo_push_token: string;
  platform: PlatformType;
  app_version: string | null;
  push_enabled: boolean;
  last_seen_at: string;
  created_at: string;
}

// ========== 2) QUESTION CONFIG ==========

export interface QuestionBankRow {
  question_code: string;
  qid: string | null;
  item_no: number | null;
  domain_code: string;
  domain_name_th: string | null;
  question_full_th: string;
  question_short_th: string | null;
  answer_type: string;
  options_json: QuestionOption[];
  condition_json: ConditionJson;
  red_flag_json: RedFlagRule;
  respondent: RespondentPolicy;
  ui_input_hint: string | null;
  required_level: RequiredLevel | null;
  summary_metric: string | null;
  mds_reference: string | null;
  license_source: string | null;
  terminology_binding: string | null;
  mvp_phase: MvpPhase | null;
  version: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CheckinTemplateRow {
  template_code: string;
  template_name_th: string;
  purpose: string | null;
  trigger_type: string;
  window_minutes: number | null;
  max_questions_target: number | null;
  notification_copy_th: string | null;
  mvp_phase: MvpPhase | null;
  active: boolean;
}

export interface TemplateQuestionRow {
  id: string;
  template_code: string;
  question_code: string;
  sort_order: number;
  required: boolean;
  condition_json: ConditionJson;
  ui_note_th: string | null;
}

// ========== 3) MEDICATION ==========

export interface MedicationRow {
  id: string;
  drug_name: string;
  drug_generic_name: string | null;
  drug_thai_name: string | null;
  medication_class: string | null;
  drug_form: string | null;
  strength: string | null;
  drug_quantity: string | null;
  dosage_instructions: string | null;
  side_effects: string | null;
  contraindications: string | null;
  interactions: string | null;
  ledd_factor: number | null;
  status: MedStatus;
  created_at: string;
  updated_at: string;
}

export interface AppointmentRow {
  id: string;
  patient_id: string;
  doctor_id: string | null;
  visit_date: string;
  visit_time: string | null;
  visit_type: VisitType | null;
  status: VisitStatus;
  created_by: string | null;
  created_appoint_name: string | null;
  created_at: string;
}

export interface PatientMedicationRow {
  prescription_id: string;
  patient_id: string;
  prescribed_by: string | null;
  prescribed_by_name: string | null;
  visit_id: string | null;
  medication_id: string;
  scheduled_times: string[];
  doses: Record<string, string>;
  frequency: string | null;
  special_instructions: string | null;
  active: boolean;
  previous_prescription_id: string | null;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface MedicationLogRow {
  id: string;
  patient_id: string;
  prescription_id: string;
  planned_at: string;
  activity_date: string;
  idempotency_key: string | null;
  taken_at: string | null;
  dose_taken: string | null;
  late_minutes: number | null;
  status: MedLogStatus;
  note: string | null;
  submitted_at: string | null;
  received_at: string;
}

// ========== 4) ROUNDS & RESPONSES ==========

export interface RoundInstanceRow {
  id: string;
  patient_id: string;
  template_code: string;
  prescription_id: string | null;
  target_dose_at: string | null;
  medication_log_id: string | null;
  appointment_id: string | null;
  scheduled_at: string;
  /** Bangkok calendar date used for lists; never derive this with UTC date truncation. */
  activity_date: string;
  /** When the activity becomes visible/actionable. scheduled_at mirrors this for API compatibility. */
  available_at: string;
  /** Preferred completion time, when one exists. Null for open-ended/previsit activities. */
  due_at: string | null;
  idempotency_key: string | null;
  expires_at: string | null;
  completed_at: string | null;
  status: RoundStatus;
  answered_by: string | null;
  submitted_at: string | null;
  received_at: string | null;
  created_at: string;
}

export interface ResponseRow {
  id: string;
  patient_id: string;
  round_instance_id: string;
  question_code: string;
  question_version: number;
  answer_value: AnswerValue;
  skipped: boolean;
  answered_by_role: RespondentRole;
  answered_at: string;
}

export interface EventLogRow {
  id: string;
  patient_id: string;
  recorded_by: string | null;
  event_type: EventType;
  severity: Severity;
  injury_occurred: boolean;
  required_er: boolean;
  on_off_time: OnOffState | null;
  occurred_at: string;
  note: string | null;
  created_at: string;
}

// ========== 5) CLINIC ==========

export interface ClinicAssessmentRow {
  id: string;
  appointment_id: string;
  patient_id: string;
  nurse_id: string | null;
  motor_tremor: boolean;
  motor_rigidity: boolean;
  motor_bradykinesia: boolean;
  motor_gait_dysfunction: boolean;
  speech_swallowing: boolean;
  gi_drooling: boolean;
  gi_dysphagia: boolean;
  gi_constipation: boolean;
  ans_oh: boolean;
  ans_urinary: boolean;
  ans_sexual: boolean;
  sleep_insomnia: boolean;
  sleep_rbd: boolean;
  sleep_nocturia: boolean;
  sleep_eds: boolean;
  neuro_anxiety: boolean;
  neuro_depression: boolean;
  neuro_hallucination: boolean;
  neuro_dementia: boolean;
  neuro_icds: boolean;
  mf_wearing_off: boolean;
  mf_delay_on: boolean;
  mf_suboptimal_on: boolean;
  mf_early_morning_off: boolean;
  mf_dyskinesia: boolean;
  mf_nocturnal_hypokinesia: boolean;
  has_caregiver: boolean;
  other_note: string | null;
  screened_by: string | null;
  status: AssessStatus;
  submitted_at: string | null;
  doctor_opened_at: string | null;
}

export interface DoctorNoteRow {
  id: string;
  appointment_id: string;
  assessment_id: string | null;
  doctor_id: string;
  clinical_note: string | null;
  medication_adjustment: boolean;
  reason_for_change: string | null;
  follow_up_urgency: Urgency | null;
  next_appointment_date: string | null;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  patient_id: string;
  device_id: string | null;
  round_instance_id: string | null;
  prescription_id: string | null;
  medication_log_id: string | null;
  appointment_id: string | null;
  type: NotifType;
  trigger_type: NotifTrigger | null;
  questions_remaining: number | null;
  triggered_at: string;
  sent_at: string | null;
  delivery_status: DeliveryStatus;
  is_read: boolean;
  created_at: string;
}

// ========== 6) SAFETY & COMPLIANCE ==========

export interface RedFlagRow {
  id: string;
  patient_id: string;
  response_id: string | null;
  event_log_id: string | null;
  question_code: string | null;
  clinic_tag: string;
  severity: FlagSeverity;
  reviewed: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface ConsentRow {
  id: string;
  user_id: string;
  consent_type: string;
  version: string;
  accepted: boolean;
  accepted_at: string;
  ip_address: string | null;
}

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: AuditAction;
  status: AuditStatus;
  target_table: string;
  target_id: string | null;
  old_value: unknown;
  new_value: unknown;
  ip_address: string | null;
  created_at: string;
}

// ========== VIEWS (§8) ==========

/** v_onoff_timeline — Hauser diary graph (FR C2). */
export interface OnOffTimelineRow {
  patient_id: string;
  ts: string;
  template_code: string;
  prescription_id: string | null;
  target_dose_at: string | null;
  state: string | null;
  dyskinesia: string | null;
  adherence: string | null;
}

/** v_patient_full — patient summary without joins. */
export interface PatientFullRow {
  id: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
  id_card_number: string | null;
  hn_number: string | null;
  gender: GenderType | null;
  date_of_birth: string;
  age: number;
  diagnosis: DiagnosisType | null;
  diagnosis_date: string | null;
  hoehn_yahr_stage: number | null;
  wake_time: string;
  sleep_time: string;
  province: string | null;
  registered_at: string;
  caregiver_count: number;
}
