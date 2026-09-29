import { z } from "zod";
import { DIAGNOSIS_TYPES, GENDER_TYPES } from "../config/constants";
import { timeSchema } from "./common";

export const createPatientProfileSchema = z.object({
  id_card_number: z.string().min(1).optional(),
  hn_number: z.string().min(1).optional(),
  gender: z.enum(GENDER_TYPES).optional(),
  date_of_birth: z.string().date(),
  diagnosis_date: z.string().date().optional(),
  diagnosis: z.enum(DIAGNOSIS_TYPES).optional(),
  other_diagnosis: z.string().optional(),
  hoehn_yahr_stage: z.number().int().min(1).max(5).optional(),
  wake_time: timeSchema,
  sleep_time: timeSchema,
  province: z.string().optional(),
});
export type CreatePatientProfileBody = z.infer<typeof createPatientProfileSchema>;

export const updatePatientProfileSchema = createPatientProfileSchema.partial().extend({
  // ชื่อ-นามสกุลอยู่ตาราง users ไม่ใช่ patient_profiles — endpoint นี้แก้ทั้งสองตารางให้ในคำขอเดียว
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
});
export type UpdatePatientProfileBody = z.infer<typeof updatePatientProfileSchema>;

export const addCaregiverSchema = z.object({
  caregiver_id: z.string().uuid(),
  relationship: z.string().optional(),
  can_answer: z.boolean().optional(),
  is_primary: z.boolean().optional(),
});
export type AddCaregiverBody = z.infer<typeof addCaregiverSchema>;

export const updateCaregiverLinkSchema = z.object({
  relationship: z.string().optional(),
  can_answer: z.boolean().optional(),
  is_primary: z.boolean().optional(),
  active: z.boolean().optional(),
});
export type UpdateCaregiverLinkBody = z.infer<typeof updateCaregiverLinkSchema>;

export const createAllergySchema = z.object({
  substance: z.string().trim().min(1).max(200),
});
