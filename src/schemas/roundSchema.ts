import { z } from "zod";
import { ROUND_STATUSES } from "../config/constants";

export const createAdhocRoundSchema = z.object({
  patient_id: z.string().uuid(),
});
export type CreateAdhocRoundBody = z.infer<typeof createAdhocRoundSchema>;

export const listRoundsQuerySchema = z.object({
  status: z.enum(ROUND_STATUSES).optional(),
  activity_date: z.string().date().optional(),
  actionable_at: z.string().datetime({ offset: true }).optional(),
  include_progress: z.enum(["true", "false"]).optional(),
});
export type ListRoundsQuery = z.infer<typeof listRoundsQuerySchema>;
