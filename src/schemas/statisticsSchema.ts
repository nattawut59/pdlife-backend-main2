import { z } from "zod";

export const statisticsQuerySchema = z.object({
  days: z.coerce.number().int().refine((value) => [7, 14, 30].includes(value), "days must be 7, 14, or 30"),
});

export const selfSummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).default(7),
});

export const dailyFluctuationQuerySchema = z.object({
  date: z.string().date(),
});
