import { z } from "zod";

export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Expected HH:MM or HH:MM:SS");
