import { z } from "zod";
import { MED_STATUSES } from "../config/constants";
import { timeSchema } from "./common";

const medicationIdSchema = z.string().regex(/^MED-\d{3}$/, "Expected format MED-###");

export const createMedicationSchema = z.object({
  id: medicationIdSchema,
  drug_name: z.string().min(1),
  drug_generic_name: z.string().optional(),
  drug_thai_name: z.string().optional(),
  medication_class: z.string().optional(),
  drug_form: z.string().optional(),
  strength: z.string().optional(),
  drug_quantity: z.string().optional(),
  dosage_instructions: z.string().optional(),
  side_effects: z.string().optional(),
  contraindications: z.string().optional(),
  interactions: z.string().optional(),
  ledd_factor: z.number().positive().optional(),
});
export type CreateMedicationBody = z.infer<typeof createMedicationSchema>;

export const updateMedicationSchema = createMedicationSchema
  .omit({ id: true })
  .partial()
  .extend({ status: z.enum(MED_STATUSES).optional() });
export type UpdateMedicationBody = z.infer<typeof updateMedicationSchema>;

export const createPrescriptionSchema = z
  .object({
    medication_id: medicationIdSchema,
    scheduled_times: z.array(timeSchema).min(1),
    doses: z.record(z.string()),
    frequency: z.string().optional(),
    special_instructions: z.string().optional(),
    start_date: z.string().date(),
    end_date: z.string().date().optional(),
    visit_id: z.string().uuid().optional(),
    previous_prescription_id: z.string().uuid().optional(),
  })
  .refine((val) => Object.keys(val.doses).length > 0, {
    message: "doses must not be empty",
    path: ["doses"],
  });
export type CreatePrescriptionBody = z.infer<typeof createPrescriptionSchema>;

export const updatePrescriptionSchema = z.object({
  scheduled_times: z.array(timeSchema).min(1).optional(),
  doses: z.record(z.string()).optional(),
  frequency: z.string().optional(),
  special_instructions: z.string().optional(),
  end_date: z.string().date().optional(),
  active: z.boolean().optional(),
});
export type UpdatePrescriptionBody = z.infer<typeof updatePrescriptionSchema>;

export const markMedicationTakenSchema = z.object({
  dose_taken: z.string().optional(),
  note: z.string().optional(),
  submitted_at: z.string().datetime().optional(),
});
export type MarkMedicationTakenBody = z.infer<typeof markMedicationTakenSchema>;

export const listMedicationLogsQuerySchema = z.object({
  activity_date: z.string().date().optional(),
});
