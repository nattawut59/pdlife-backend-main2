import { z } from "zod";
import { EVENT_TYPES, ONOFF_STATES, SEVERITIES } from "../config/constants";

export const createEventLogSchema = z.object({
  event_type: z.enum(EVENT_TYPES),
  severity: z.enum(SEVERITIES),
  injury_occurred: z.boolean().optional().default(false),
  required_er: z.boolean().optional().default(false),
  on_off_time: z.enum(ONOFF_STATES).optional(),
  occurred_at: z.string().datetime(),
  note: z.string().optional(),
});
export type CreateEventLogBody = z.infer<typeof createEventLogSchema>;
